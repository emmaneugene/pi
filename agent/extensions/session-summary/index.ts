/**
 * Session Summary Extension
 *
 * Generates a one-line LLM summary of the current coding session and sets it
 * as the session name, so sessions are findable in /resume. Regenerated at
 * natural boundaries (fork and shutdown) whenever there's something to
 * summarize; always a fresh full-conversation summary, not an incremental
 * update.
 *
 * Commands: /summary:update, /summary:settings
 * Reference: https://github.com/pasky/pi-session-summary
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { complete } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

// -- Configuration --------------------------------------------------------

interface SummaryConfig {
  provider: string;
  model: string;
  maxTokens: number;
  timeoutSeconds: number;
}

const DEFAULTS = {
  maxTokens: 300,
  timeoutSeconds: 10,
};

// Keep the conversation we send well under any model's context window.
// ~4 chars/token; this budgets ~15k tokens, leaving headroom for prompt
// overhead and the model's own output on small-context cheap models.
const MAX_CONVERSATION_CHARS = 60_000;
const TRUNCATION_NOTICE = "[... earlier conversation truncated ...]";

const SUMMARY_STATUS_KEY = "session-summary";

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function loadConfig(cwd: string): SummaryConfig | undefined {
  const globalPath = join(getAgentDir(), "session-summary.json");
  const projectPath = join(cwd, CONFIG_DIR_NAME, "session-summary.json");

  let raw: Record<string, unknown> = { ...DEFAULTS };

  for (const path of [globalPath, projectPath]) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const parsed = JSON.parse(content);
        raw = { ...raw, ...parsed };
      } catch (err) {
        console.error(
          `[session-summary] Failed to load config from ${path}: ${err}`,
        );
      }
    }
  }

  const provider = toNonEmptyString(raw.provider);
  const model = toNonEmptyString(raw.model);
  if (!provider || !model) return undefined;

  return {
    provider,
    model,
    maxTokens: toPositiveInt(raw.maxTokens, DEFAULTS.maxTokens),
    timeoutSeconds: toPositiveInt(raw.timeoutSeconds, DEFAULTS.timeoutSeconds),
  };
}

// -- Types ----------------------------------------------------------------

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
}

interface SessionEntry {
  type: string;
  id: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  /** Present on type: "compaction" entries. */
  summary?: string;
  firstKeptEntryId?: string;
}

// -- Helpers --------------------------------------------------------------

/** Extract only user+assistant text from a content field, collapsing tool i/o. */
function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as ContentBlock;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "toolCall" && typeof b.name === "string") {
      parts.push(`[tool call: ${b.name}]`);
    }
  }
  return parts.join("\n");
}

/** Render entries into one line each (user/assistant text, or a tool-result byte count). */
function buildConversationLines(entries: SessionEntry[]): string[] {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message?.role) continue;
    const role = entry.message.role;

    if (role === "user") {
      const text = renderContent(entry.message.content).trim();
      if (text) lines.push(`User: ${text}`);
    } else if (role === "assistant") {
      const text = renderContent(entry.message.content).trim();
      if (text) lines.push(`Assistant: ${text}`);
    } else if (role === "toolResult") {
      const contentStr = renderContent(entry.message.content);
      const bytes = new TextEncoder().encode(contentStr).length;
      lines.push(`[tool result: ${bytes} bytes]`);
    }
  }

  return lines;
}

/**
 * Bound the summarizer's input to what's happened since the last compaction
 * (or the whole session, if it hasn't been compacted yet): the compaction's
 * own summary text, plus every entry kept after it. Compaction already keeps
 * this span small in the common case (bounded by keepRecentTokens), so this
 * is the natural place to start rather than an arbitrary cutoff.
 */
function sinceLastCompaction(branch: SessionEntry[]): {
  entries: SessionEntry[];
  compactionSummary?: string;
} {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "compaction" || !entry.firstKeptEntryId) continue;
    const keptIdx = branch.findIndex((e) => e.id === entry.firstKeptEntryId);
    return {
      entries: keptIdx >= 0 ? branch.slice(keptIdx) : branch.slice(i + 1),
      compactionSummary: entry.summary,
    };
  }
  return { entries: branch };
}

/** Keep only the most recent whole lines that fit the budget — never split a line. */
function truncateLines(
  lines: string[],
  maxChars: number,
): { lines: string[]; truncated: boolean } {
  let total = 0;
  let startIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const size = lines[i].length + 1; // +1 for the joining newline
    if (total + size > maxChars && total > 0) break;
    total += size;
    startIdx = i;
  }
  return { lines: lines.slice(startIdx), truncated: startIdx > 0 };
}

function hasSummarizableText(entries: SessionEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.type !== "message") return false;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") return false;
    return renderContent(entry.message.content).trim().length > 0;
  });
}

/** Conversation text to summarize: since the last compaction, capped as a backstop. */
function buildSummarizableConversation(branch: SessionEntry[]): string {
  const { entries, compactionSummary } = sinceLastCompaction(branch);
  const allLines = compactionSummary
    ? [
        `[compaction summary: ${compactionSummary.trim()}]`,
        ...buildConversationLines(entries),
      ]
    : buildConversationLines(entries);

  // Budget the compaction summary and recent entries together, prioritizing
  // recent entries: if something has to be dropped to fit, it's the old
  // summary, not the recent messages the prompt actually asks about.
  const { lines: kept, truncated } = truncateLines(
    allLines,
    MAX_CONVERSATION_CHARS,
  );
  return truncated ? [TRUNCATION_NOTICE, ...kept].join("\n") : kept.join("\n");
}

// -- Extension ------------------------------------------------------------

export default function sessionSummaryExtension(pi: ExtensionAPI) {
  // -- State ------------------------------------------------------------
  let config: SummaryConfig | undefined;

  // -- Helpers ----------------------------------------------------------

  function setSummaryStatus(
    ctx: ExtensionContext,
    state: "idle" | "generating" | "error",
  ) {
    if (!ctx.hasUI) return;
    if (state === "idle") {
      ctx.ui.setStatus(SUMMARY_STATUS_KEY, undefined);
      return;
    }

    if (state === "generating") {
      ctx.ui.setStatus(
        SUMMARY_STATUS_KEY,
        ctx.ui.theme.fg("accent", "⏳ summary: generating"),
      );
      return;
    }

    ctx.ui.setStatus(
      SUMMARY_STATUS_KEY,
      ctx.ui.theme.fg("error", "✗ summary: failed"),
    );
  }

  /** Generate a fresh full-conversation summary and set it as the session name. */
  async function generateSummary(ctx: ExtensionContext): Promise<void> {
    setSummaryStatus(ctx, "idle");

    if (!config) {
      ctx.ui.notify(
        "[session-summary] No provider/model configured. Run /summary:settings",
        "error",
      );
      return;
    }

    const model = ctx.modelRegistry.find(config.provider, config.model);
    if (!model) {
      ctx.ui.notify("[session-summary] Model not found", "error");
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth?.ok || !auth.apiKey) {
      ctx.ui.notify("[session-summary] No API key available", "error");
      return;
    }

    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    const conversation = buildSummarizableConversation(branch);

    if (!conversation.trim()) {
      ctx.ui.notify("[session-summary] Nothing to summarize", "info");
      return;
    }

    const prompt = [
      "Summarize this coding session in a SINGLE SHOT line (max ~80 chars).",
      "Highlight: headline what the user is working on, current progress, and immediate next step (if outlined).",
      "Be specific and concrete, not vague.",
      "",
      "<conversation>",
      conversation,
      "</conversation>",
    ].join("\n");

    setSummaryStatus(ctx, "generating");
    ctx.ui.notify("Generating summary...", "info");

    let successful = false;

    try {
      const timeoutMs = config.timeoutSeconds * 1000;
      const response = await complete(
        model,
        {
          systemPrompt:
            "You are a concise summarizer. Output a single line summary of a coding session.",
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: config.maxTokens,
          sessionId: ctx.sessionManager.getSessionId(),
          signal: AbortSignal.timeout(timeoutMs),
        } as any,
      );

      if (response.stopReason === "error") {
        const errMsg = response.errorMessage || "unknown provider error";
        setSummaryStatus(ctx, "error");
        ctx.ui.notify(`[session-summary] Error: ${errMsg}`, "error");
        return;
      }

      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join(" ")
        .trim()
        .replace(/\n+/g, " ");

      if (text) {
        const currentModel = ctx.model;
        const displayModel = currentModel ? `[${currentModel.id}] ` : "";
        pi.setSessionName(`${displayModel}${text}`);
        successful = true;
        ctx.ui.notify(`Summary: ${text}`, "info");
      } else {
        setSummaryStatus(ctx, "error");
        ctx.ui.notify("[session-summary] Empty summary response", "error");
      }
    } catch (err) {
      setSummaryStatus(ctx, "error");
      const msg = (err as any)?.message || String(err);
      ctx.ui.notify(`[session-summary] ${msg}`, "error");
    } finally {
      if (successful) {
        setSummaryStatus(ctx, "idle");
      }
    }
  }

  /** Generate a summary at natural boundaries when configured and there's something to summarize. */
  async function triggerSummary(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || !config) return;
    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    if (!hasSummarizableText(sinceLastCompaction(branch).entries)) return;
    await generateSummary(ctx);
  }

  // -- Commands ---------------------------------------------------------

  pi.registerCommand("summary:settings", {
    description: "Create/show session-summary settings file",
    handler: async (_args, ctx) => {
      const globalPath = join(getAgentDir(), "session-summary.json");
      if (!existsSync(globalPath)) {
        mkdirSync(dirname(globalPath), { recursive: true });
        writeFileSync(
          globalPath,
          JSON.stringify({ ...DEFAULTS, provider: "", model: "" }, null, 2) +
            "\n",
        );
        ctx.ui.notify(
          `Created ${globalPath} — set provider and model, then /reload`,
          "info",
        );
      } else {
        ctx.ui.notify(`Settings: ${globalPath}`, "info");
      }
    },
  });

  pi.registerCommand("summary:update", {
    description: "Force-update the session summary now",
    handler: async (_args, ctx) => {
      await generateSummary(ctx);
    },
  });

  // -- Event handlers ---------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    setSummaryStatus(ctx, "idle");
  });

  pi.on("session_before_fork", async (_event, ctx) => {
    await triggerSummary(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // Escape clause for skipping summary
    if (
      ctx.sessionManager
        .getEntries()
        .some((e) => e.type === "custom" && e.customType === "skip-summary")
    ) {
      return;
    }

    await triggerSummary(ctx);
  });
}
