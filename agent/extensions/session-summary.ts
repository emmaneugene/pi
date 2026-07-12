/**
 * Session Summary Extension
 *
 * Generates a one-line LLM summary of the current coding session and sets it
 * as the session name. Summaries are offered at natural boundaries (fork and
 * shutdown) with explicit user confirmation.
 *
 * Commands: /summary:update, /summary:clear, /summary:settings
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
  resummarizeThreshold: number;
  verbose: boolean;
}

const DEFAULTS = {
  maxTokens: 300,
  timeoutSeconds: 10,
  resummarizeThreshold: 50_000,
  verbose: false,
};

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

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
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
    resummarizeThreshold: toPositiveInt(
      raw.resummarizeThreshold,
      DEFAULTS.resummarizeThreshold,
    ),
    verbose: toBoolean(raw.verbose, DEFAULTS.verbose),
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

/** Build a compact conversation string from session entries. */
function buildConversation(entries: SessionEntry[]): string {
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
    } else if (role === "compactionSummary") {
      const text = renderContent(entry.message.content).trim();
      if (text) lines.push(`[compaction summary: ${text}]`);
    }
  }

  return lines.join("\n");
}

// -- Extension ------------------------------------------------------------

export default function sessionSummaryExtension(pi: ExtensionAPI) {
  // -- State ------------------------------------------------------------
  let config: SummaryConfig | undefined;
  let resolvedModelName = "";
  let lastSummary = "";
  let lastSummaryEntryId = "";

  // -- Helpers ----------------------------------------------------------

  function restoreFromSessionName(ctx: ExtensionContext) {
    const name = pi.getSessionName();
    if (!name) return;

    // Strip any model prefix like "[model-id] " that we may have prepended
    const modelPrefixMatch = name.match(/^\[([^\]]+)\] (.+)$/);
    lastSummary = modelPrefixMatch ? modelPrefixMatch[2] : name;
    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    lastSummaryEntryId = branch[branch.length - 1]?.id ?? "";
  }

  function resetState() {
    lastSummary = "";
    lastSummaryEntryId = "";
    resolvedModelName = "";
    config = undefined;
  }

  function resolveModel(): { provider: string; model: string } | undefined {
    if (!config) return undefined;
    resolvedModelName = `${config.provider}/${config.model}`;
    return { provider: config.provider, model: config.model };
  }

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

  /** Find the index of an entry by id, searching from the end. */
  function findEntryIndex(entries: SessionEntry[], entryId: string): number {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].id === entryId) return i;
    }
    return -1;
  }

  /** Get entries added after the last summary, or all entries if no summary exists. */
  function getNewEntries(branch: SessionEntry[]): SessionEntry[] | null {
    if (!lastSummaryEntryId) return null; // no previous summary
    const idx = findEntryIndex(branch, lastSummaryEntryId);
    if (idx < 0) return null; // entry gone (e.g. compaction), treat as full
    return branch.slice(idx + 1);
  }

  function hasSummarizableText(entries: SessionEntry[]): boolean {
    return entries.some((entry) => {
      if (entry.type !== "message") return false;
      const role = entry.message?.role;
      if (role !== "user" && role !== "assistant") return false;
      return renderContent(entry.message.content).trim().length > 0;
    });
  }

  /** Estimate tokens from user+assistant text only (excludes tool results). ~4 chars per token. */
  function estimateUserAssistantTokens(entries: SessionEntry[]): number {
    let chars = 0;
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const role = entry.message?.role;
      if (role !== "user" && role !== "assistant") continue;
      chars += renderContent(entry.message.content).trim().length;
    }
    return Math.ceil(chars / 4);
  }

  /** Returns true if we should offer to generate a summary. */
  function shouldOffer(ctx: ExtensionContext): boolean {
    if (!config) return false;
    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    if (!hasSummarizableText(branch)) return false;
    if (!lastSummary) return true;

    const newEntries = getNewEntries(branch);
    if (!newEntries) return true; // no anchor → offer
    return (
      estimateUserAssistantTokens(newEntries) >= config.resummarizeThreshold
    );
  }

  /** Await the LLM to generate and store a summary. */
  async function generateSummary(ctx: ExtensionContext): Promise<void> {
    setSummaryStatus(ctx, "idle");

    const runtimeConfig = config;
    const resolved = resolveModel();
    if (!runtimeConfig || !resolved) {
      ctx.ui.notify(
        "[session-summary] No provider/model configured. Run /summary:settings",
        "error",
      );
      return;
    }

    const model = ctx.modelRegistry.find(resolved.provider, resolved.model);
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
    const fullConversation = buildConversation(branch);

    if (!fullConversation.trim()) {
      ctx.ui.notify("[session-summary] Nothing to summarize", "info");
      return;
    }

    const newEntries = getNewEntries(branch);
    const newConversation = newEntries
      ? buildConversation(newEntries).trim()
      : "";
    const isIncremental = lastSummary && newEntries && newConversation;

    let prompt: string;
    if (isIncremental) {
      prompt = [
        "Here is the previous one-line summary of this coding session:",
        `"${lastSummary}"`,
        "",
        "Here is the new conversation since that summary was generated:",
        "<conversation>",
        newConversation,
        "</conversation>",
        "",
        "Update the summary ONLY if there has been material progress or a change in direction.",
        "If nothing material changed, return the previous summary exactly.",
        "Summarize this coding session (not just progress from last time!) in a SINGLE SHOT line (max ~80 chars).",
        "Highlight: headline what the user is working on, current progress, and immediate next step (if outlined).",
        "Be specific and concrete, not vague.",
      ].join("\n");
    } else {
      prompt = [
        "Summarize this coding session in a SINGLE SHOT line (max ~80 chars).",
        "Highlight: headline what the user is working on, current progress, and immediate next step (if outlined).",
        "Be specific and concrete, not vague.",
        "",
        "<conversation>",
        fullConversation,
        "</conversation>",
      ].join("\n");
    }

    setSummaryStatus(ctx, "generating");
    ctx.ui.notify("Generating summary...", "info");

    let successful = false;

    try {
      const timeoutMs = runtimeConfig.timeoutSeconds * 1000;
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
          maxTokens: runtimeConfig.maxTokens,
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
        const changed = text !== lastSummary;
        lastSummary = text;
        lastSummaryEntryId = branch[branch.length - 1]?.id ?? "";
        const currentModel = ctx.model;
        const displayModel = currentModel ? `[${currentModel.id}] ` : "";
        pi.setSessionName(`${displayModel}${lastSummary}`);
        successful = true;
        if (runtimeConfig.verbose && changed) {
          const mode = isIncremental ? "incremental" : "full";
          ctx.ui.notify(`[summary:${mode}] ${lastSummary}`, "info");
        } else {
          ctx.ui.notify(`Summary: ${lastSummary}`, "info");
        }
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

  /** Generate a summary at natural boundaries when configured and warranted. */
  async function triggerSummary(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || !shouldOffer(ctx)) return;
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

  pi.registerCommand("summary:clear", {
    description: "Clear the session summary/name",
    handler: async (_args, ctx) => {
      lastSummary = "";
      lastSummaryEntryId = "";
      setSummaryStatus(ctx, "idle");
      pi.setSessionName("");
      ctx.ui.notify("Summary cleared", "info");
    },
  });

  // -- Event handlers ---------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    resetState();
    setSummaryStatus(ctx, "idle");
    config = loadConfig(ctx.cwd);
    resolveModel();
    restoreFromSessionName(ctx);
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
