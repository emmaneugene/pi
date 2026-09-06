/**
 * Names the session `[model] (branch) summary`.
 *
 * First user message: cheap name. After settle: LLM summary, reused until
 * compaction makes it stale. Fork and shutdown recompose model and branch.
 *
 * A user-set name latches `user-named`. Auto refresh does not change it.
 * `/summary:update` clears the lock and rewrites.
 *
 * Commands: /summary:update, /summary:settings
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { complete } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { detectGitBranch } from "../../lib/git-branch.ts";

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

// ~4 chars/token → ~15k tokens, under small-model context windows.
const MAX_CONVERSATION_CHARS = 60_000;
const TRUNCATION_NOTICE = "[... earlier conversation truncated ...]";

const SUMMARY_STATUS_KEY = "session-summary";

const SUMMARY_ENTRY_TYPE = "session-summary";
const SKIP_ENTRY_TYPE = "skip-summary";
/** Latch against auto refresh. Latest `{ locked }` wins. */
const USER_NAMED_ENTRY_TYPE = "user-named";
const MAX_SUMMARY_CHARS = 100;

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
  summary?: string;
  firstKeptEntryId?: string;
  customType?: string;
  data?: unknown;
  modelId?: string;
}

interface SummaryState {
  text?: string;
  /** Absent on summaries written before this field. */
  composedName?: string;
  stale: boolean;
}

type RefreshReason = "force" | "cheap" | "settle" | "recompose";

// -- Helpers --------------------------------------------------------------

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

/** Entries after the last compaction, or the whole branch. */
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

/** Drop oldest whole lines until the budget fits. */
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

export function oneLine(text: string, max = MAX_SUMMARY_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}\u2026` : flat;
}

function parseSummaryData(data: unknown): {
  text?: string;
  composedName?: string;
} {
  if (!data || typeof data !== "object") return {};
  const record = data as { text?: unknown; composedName?: unknown };
  return {
    text: toNonEmptyString(record.text),
    composedName: toNonEmptyString(record.composedName),
  };
}

function parseLockedFlag(data: unknown): boolean | undefined {
  if (!data || typeof data !== "object") return undefined;
  const locked = (data as { locked?: unknown }).locked;
  return typeof locked === "boolean" ? locked : undefined;
}

/** Stale when missing, or when a compaction landed after the summary. */
export function readSummaryState(branch: SessionEntry[]): SummaryState {
  let summaryIdx = -1;
  let compactionIdx = -1;
  let text: string | undefined;
  let composedName: string | undefined;

  branch.forEach((entry, i) => {
    if (entry.type === "custom" && entry.customType === SUMMARY_ENTRY_TYPE) {
      summaryIdx = i;
      const parsed = parseSummaryData(entry.data);
      text = parsed.text;
      composedName = parsed.composedName;
    } else if (entry.type === "compaction") {
      compactionIdx = i;
    }
  });

  return {
    text,
    composedName,
    stale: summaryIdx === -1 || compactionIdx > summaryIdx,
  };
}

/**
 * Who owns the session name: "skipped" once any skip marker exists (e.g.
 * after /move), "locked" while the latest valid user-named latch is set,
 * otherwise "auto".
 */
export function namingOwner(
  branch: SessionEntry[],
): "skipped" | "locked" | "auto" {
  let locked: boolean | undefined;
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "custom") continue;
    if (entry.customType === SKIP_ENTRY_TYPE) return "skipped";
    if (entry.customType === USER_NAMED_ENTRY_TYPE && locked === undefined) {
      locked = parseLockedFlag(entry.data);
    }
  }
  return locked ? "locked" : "auto";
}

/** Lock a cleared name, or a live name that differs from the expected compose. */
export function shouldLockSessionName(
  live: string | undefined,
  expected: string | undefined,
): boolean {
  const liveName = live?.trim() ?? "";
  if (liveName.length === 0) return true;
  return liveName !== (expected ?? "");
}

export function shouldGenerateSummary(input: {
  reason: RefreshReason;
  hasConfig: boolean;
  stale: boolean;
  hasText: boolean;
}): boolean {
  if (input.reason === "cheap" || input.reason === "recompose") return false;
  if (input.reason === "force") return true;
  return input.hasConfig && input.stale && input.hasText;
}

function spokenText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is ContentBlock =>
        Boolean(block) &&
        typeof block === "object" &&
        (block as ContentBlock).type === "text" &&
        typeof (block as ContentBlock).text === "string",
    )
    .map((block) => block.text ?? "")
    .join("\n");
}

function spokenLine(content: unknown): string | undefined {
  const text = oneLine(spokenText(content));
  return text.length > 0 ? text : undefined;
}

/** Prefer the `message_end` body; Pi has not persisted that message yet. */
export function cheapSummaryText(
  eventContent: unknown,
  branch: SessionEntry[],
): string | undefined {
  return spokenLine(eventContent) ?? firstUserMessageText(branch);
}

export function lastMessageText(branch: SessionEntry[]): string | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = spokenLine(entry.message?.content);
    if (text) return text;
  }
  return undefined;
}

export function firstUserMessageText(
  branch: SessionEntry[],
): string | undefined {
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const text = spokenLine(entry.message.content);
    if (text) return text;
  }
  return undefined;
}

export function currentModelId(
  ctx: ExtensionContext,
  branch: SessionEntry[],
): string | undefined {
  if (ctx.model?.id) return ctx.model.id;
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "model_change" && entry.modelId) return entry.modelId;
  }
  return undefined;
}

export function composeSessionName(parts: {
  modelId?: string;
  gitBranch?: string;
  summary?: string;
}): string | undefined {
  const segments = [
    parts.modelId ? `[${parts.modelId}]` : undefined,
    parts.gitBranch ? `(${parts.gitBranch})` : undefined,
    parts.summary,
  ].filter((segment): segment is string => Boolean(segment));
  return segments.length > 0 ? segments.join(" ") : undefined;
}

function hasSummarizableText(entries: SessionEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.type !== "message") return false;
    const message = entry.message;
    if (message?.role !== "user" && message?.role !== "assistant") {
      return false;
    }
    return renderContent(message.content).trim().length > 0;
  });
}

function buildSummarizableConversation(branch: SessionEntry[]): string {
  const { entries, compactionSummary } = sinceLastCompaction(branch);
  const allLines = compactionSummary
    ? [
        `[compaction summary: ${compactionSummary.trim()}]`,
        ...buildConversationLines(entries),
      ]
    : buildConversationLines(entries);

  // Prefer recent messages: truncation drops the old compaction summary first.
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
  /** Own writes, so `session_info_changed` does not lock them. */
  const appliedNames = new Set<string>();
  let refreshChain = Promise.resolve();

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

  async function generateSummary(
    ctx: ExtensionContext,
    branch: SessionEntry[],
  ): Promise<string | undefined> {
    setSummaryStatus(ctx, "idle");

    if (!config) {
      ctx.ui.notify(
        "[session-summary] No provider/model configured. Run /summary:settings",
        "error",
      );
      return undefined;
    }

    const model = ctx.modelRegistry.find(config.provider, config.model);
    if (!model) {
      ctx.ui.notify("[session-summary] Model not found", "error");
      return undefined;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth?.ok || !auth.apiKey) {
      ctx.ui.notify("[session-summary] No API key available", "error");
      return undefined;
    }

    const conversation = buildSummarizableConversation(branch);

    if (!conversation.trim()) {
      ctx.ui.notify("[session-summary] Nothing to summarize", "info");
      return undefined;
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
        },
      );

      if (response.stopReason === "error") {
        const errMsg = response.errorMessage || "unknown provider error";
        setSummaryStatus(ctx, "error");
        ctx.ui.notify(`[session-summary] Error: ${errMsg}`, "error");
        return undefined;
      }

      const text = oneLine(
        response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join(" "),
      );

      if (!text) {
        setSummaryStatus(ctx, "error");
        ctx.ui.notify("[session-summary] Empty summary response", "error");
        return undefined;
      }

      successful = true;
      ctx.ui.notify(`Summary: ${text}`, "info");
      return text;
    } catch (err) {
      setSummaryStatus(ctx, "error");
      const msg = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`[session-summary] ${msg}`, "error");
      return undefined;
    } finally {
      if (successful) {
        setSummaryStatus(ctx, "idle");
      }
    }
  }

  function applySessionName(name: string): void {
    appliedNames.add(name.replace(/[\r\n]+/g, " ").trim());
    pi.setSessionName(name);
  }

  async function expectedName(
    ctx: ExtensionContext,
    branch: SessionEntry[],
  ): Promise<string | undefined> {
    const state = readSummaryState(branch);
    if (state.composedName) return state.composedName;
    return composeSessionName({
      modelId: currentModelId(ctx, branch),
      gitBranch: (await detectGitBranch(pi, ctx.cwd)).branch,
      summary: state.text ?? firstUserMessageText(branch),
    });
  }

  function refreshSessionName(
    ctx: ExtensionContext,
    reason: RefreshReason,
    options: { fallbackSummary?: string } = {},
  ): Promise<void> {
    const run = refreshChain.then(
      () => refreshSessionNameNow(ctx, reason, options),
      () => refreshSessionNameNow(ctx, reason, options),
    );
    refreshChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function stillAutoNamed(
    branch: SessionEntry[],
    reason: RefreshReason,
  ): boolean {
    const owner = namingOwner(branch);
    return owner === "auto" || (owner === "locked" && reason === "force");
  }

  async function refreshSessionNameNow(
    ctx: ExtensionContext,
    reason: RefreshReason,
    options: { fallbackSummary?: string },
  ): Promise<void> {
    if (!ctx.hasUI) return;

    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    if (!stillAutoNamed(branch, reason)) return;

    if (reason === "force" && namingOwner(branch) === "locked") {
      pi.appendEntry(USER_NAMED_ENTRY_TYPE, { locked: false });
    }

    const state = readSummaryState(branch);
    const generate = shouldGenerateSummary({
      reason,
      hasConfig: Boolean(config),
      stale: state.stale,
      hasText: hasSummarizableText(sinceLastCompaction(branch).entries),
    });

    const generated = generate ? await generateSummary(ctx, branch) : undefined;
    const afterGenerate = ctx.sessionManager.getBranch() as SessionEntry[];
    if (!stillAutoNamed(afterGenerate, reason)) return;

    const summary =
      generated ??
      state.text ??
      (reason === "cheap"
        ? (options.fallbackSummary ?? firstUserMessageText(afterGenerate))
        : lastMessageText(afterGenerate));

    const name = composeSessionName({
      modelId: currentModelId(ctx, afterGenerate),
      gitBranch: (await detectGitBranch(pi, ctx.cwd)).branch,
      summary,
    });
    if (!name) return;

    const afterGit = ctx.sessionManager.getBranch() as SessionEntry[];
    if (!stillAutoNamed(afterGit, reason)) return;

    const persistSummary =
      generated !== undefined ||
      (Boolean(summary) && !state.stale && state.composedName !== name);
    if (persistSummary && summary) {
      pi.appendEntry(SUMMARY_ENTRY_TYPE, { text: summary, composedName: name });
    }

    if (pi.getSessionName() === name) return;
    applySessionName(name);
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
      await refreshSessionName(ctx, "force");
    },
  });

  // -- Event handlers ---------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    setSummaryStatus(ctx, "idle");
    if (!ctx.hasUI) return;

    const live = pi.getSessionName();
    if (!live) return;

    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    if (namingOwner(branch) !== "auto") return;

    const expected = await expectedName(ctx, branch);
    if (shouldLockSessionName(live, expected)) {
      pi.appendEntry(USER_NAMED_ENTRY_TYPE, { locked: true });
    }
  });

  pi.on("session_info_changed", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.name !== undefined && appliedNames.delete(event.name)) return;

    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    if (namingOwner(branch) !== "auto") return;

    if (
      shouldLockSessionName(event.name, readSummaryState(branch).composedName)
    ) {
      pi.appendEntry(USER_NAMED_ENTRY_TYPE, { locked: true });
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "user") return;

    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    if (namingOwner(branch) !== "auto") return;
    if (readSummaryState(branch).text) return;
    if (pi.getSessionName()) return;

    const fallbackSummary = cheapSummaryText(event.message.content, branch);
    if (!fallbackSummary) return;

    await refreshSessionName(ctx, "cheap", { fallbackSummary });
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await refreshSessionName(ctx, "settle");
  });

  pi.on("session_before_fork", async (_event, ctx) => {
    await refreshSessionName(ctx, "recompose");
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await refreshSessionName(ctx, "recompose");
  });
}
