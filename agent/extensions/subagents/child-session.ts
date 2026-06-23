/**
 * child-session.ts — Construct and run a child pi AgentSession.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  buildSessionContext,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { detectEnv } from "./env.ts";
import { filterActiveTools, resolveAllowedTools } from "./gating.ts";
import { buildAgentPrompt } from "./prompts.ts";
import type { AgentConfig, ThinkingLevel } from "./types.ts";

/** Streaming callbacks the manager wires to a record + widget. */
export interface RunCallbacks {
  onToolActivity?: (a: { type: "start" | "end"; toolName: string }) => void;
  onTurnEnd?: (turnCount: number) => void;
  onAssistantUsage?: (u: {
    input: number;
    output: number;
    cacheWrite: number;
  }) => void;
  onSessionCreated?: (s: AgentSession) => void;
  /** Fires once the persisted transcript path is known (before the run starts). */
  onTranscript?: (file: string | undefined) => void;
}

export interface RunOptions {
  pi: ExtensionAPI;
  agentId: string;
  /** Explicit model override (already resolved). Falls back to config/parent. */
  model?: Model<any>;
  maxTurns?: number;
  graceTurns?: number;
  thinkingLevel?: ThinkingLevel;
  inheritContext?: boolean;
  signal?: AbortSignal;
}

export interface RunResult {
  responseText: string;
  session: AgentSession;
  aborted: boolean;
  steered: boolean;
}

/**
 * Persist child transcripts under the parent session's `subagents/` folder.
 * Falls back to a temp dir in headless mode.
 */
export function deriveChildSessionDir(ctx: ExtensionContext): string {
  try {
    const parentDir = ctx.sessionManager?.getSessionDir?.();
    if (parentDir) return join(parentDir, "subagents");
  } catch {
    // headless / --no-session: no parent dir available
  }
  return join(tmpdir(), "pi-subagents-sessions");
}

/** Resolve config.model ("provider/id" or fuzzy substring) against the registry. */
export function resolveModel(
  input: string | undefined,
  registry: ExtensionContext["modelRegistry"],
  parent: Model<any> | undefined,
): Model<any> | undefined {
  if (!input) return parent;
  const available = registry.getAvailable?.() ?? [];
  // exact provider/id
  const slash = input.indexOf("/");
  if (slash !== -1) {
    const found = registry.find(input.slice(0, slash), input.slice(slash + 1));
    if (
      found &&
      available.some((m) => m.provider === found.provider && m.id === found.id)
    ) {
      return found;
    }
  }
  // fuzzy: first available model whose id contains the input
  const lower = input.toLowerCase();
  const fuzzy = available.find((m) => m.id.toLowerCase().includes(lower));
  return fuzzy ?? parent;
}

/** Normalize max turns. undefined/0 -> unlimited; else min 1. */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
  if (n == null || n === 0) return undefined;
  return Math.max(1, n);
}

export async function runChildSession(
  ctx: ExtensionContext,
  config: AgentConfig,
  prompt: string,
  options: RunOptions,
  callbacks: RunCallbacks,
): Promise<RunResult> {
  const cwd = ctx.cwd;
  const env = await detectEnv(options.pi, cwd);
  const systemPrompt = buildAgentPrompt(
    config,
    cwd,
    env,
    ctx.getSystemPrompt(),
  );

  // Point 1: gate built-ins and the initial active set.
  const tools = resolveAllowedTools(config);

  // 3. Suppress pi's AGENTS.md/APPEND_SYSTEM re-append. buildSystemPrompt()
  // re-appends those AFTER systemPromptOverride; without these flags a
  // prompt_mode:"replace" agent silently inherits the parent's AGENTS.md.
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  // 4. reload() before createSession — ordering dependency with no type signal.
  await loader.reload();

  const model =
    options.model ?? resolveModel(config.model, ctx.modelRegistry, ctx.model);

  // Child transcripts are pi-native JSONL, linked to the current session.
  // Headless mode falls back to a temp dir.
  const sessionDir = deriveChildSessionDir(ctx);
  let parentSessionId: string | undefined;
  try {
    parentSessionId = ctx.sessionManager?.getSessionId?.();
  } catch {
    parentSessionId = undefined;
  }
  const sessionManager = SessionManager.create(cwd, sessionDir, {
    parentSession: parentSessionId,
  });
  const transcriptFile = sessionManager.getSessionFile();
  callbacks.onTranscript?.(transcriptFile);

  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    sessionManager,
    settingsManager: SettingsManager.create(cwd, getAgentDir()),
    modelRegistry: ctx.modelRegistry,
    model,
    tools, // 1. explicit allowlist
    resourceLoader: loader,
    ...((options.thinkingLevel ?? config.thinking)
      ? { thinkingLevel: options.thinkingLevel ?? config.thinking }
      : {}),
  });

  session.setSessionName(
    `${config.displayName ?? config.name}#${options.agentId.slice(0, 8)}`,
  );

  // Bind extensions so extension tools register.
  await session.bindExtensions({});

  // 2. Extension tools register after bindExtensions; strip every unlisted tool.
  const active = session.getActiveToolNames();
  const guarded = filterActiveTools(active, config);
  if (guarded.length !== active.length) session.setActiveToolsByName(guarded);

  callbacks.onSessionCreated?.(session);

  // 5. Graceful turn limits: soft steer at the limit, hard abort after grace.
  let turnCount = 0;
  const maxTurns = normalizeMaxTurns(options.maxTurns ?? config.maxTurns);
  const grace = options.graceTurns ?? 5;
  let softLimitReached = false;
  let aborted = false;

  // 6. Result collection: accumulate text_delta between message boundaries.
  let currentText = "";
  let lastFullText = "";

  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "turn_end") {
      turnCount++;
      callbacks.onTurnEnd?.(turnCount);
      if (maxTurns != null) {
        if (!softLimitReached && turnCount >= maxTurns) {
          softLimitReached = true;
          void session.steer(
            "You have reached your turn limit. Wrap up immediately — provide your final answer now.",
          );
        } else if (softLimitReached && turnCount >= maxTurns + grace) {
          aborted = true;
          void session.abort();
        }
      }
    }
    if (event.type === "message_start") currentText = "";
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      currentText += event.assistantMessageEvent.delta;
      lastFullText = currentText;
    }
    if (event.type === "tool_execution_start") {
      callbacks.onToolActivity?.({ type: "start", toolName: event.toolName });
    }
    if (event.type === "tool_execution_end") {
      callbacks.onToolActivity?.({ type: "end", toolName: event.toolName });
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const u = (event.message as any).usage;
      if (u) {
        callbacks.onAssistantUsage?.({
          input: u.input ?? 0,
          output: u.output ?? 0,
          cacheWrite: u.cacheWrite ?? 0,
        });
      }
    }
  });

  // 7. forward parent abort -> child abort.
  const onAbort = () => void session.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  // inherit_context: prepend a compact parent transcript (optional, off by default).
  const effectivePrompt = options.inheritContext
    ? buildParentContext(ctx) + prompt
    : prompt;

  try {
    await session.prompt(effectivePrompt);
  } finally {
    unsub();
    options.signal?.removeEventListener("abort", onAbort);
  }

  const responseText = lastFullText.trim() || getLastAssistantText(session);
  return { responseText, session, aborted, steered: softLimitReached };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getLastAssistantText(session: AgentSession): string {
  const msgs = session.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "assistant") continue;
    const text = extractText((m as any).content).trim();
    if (text) return text;
  }
  return "";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
}

const MAX_PARENT_MESSAGES = 12;
const MAX_PARENT_CONTEXT_CHARS = 12_000;
const MAX_PARENT_MESSAGE_CHARS = 2_000;

/** Compact recent parent conversation for inherit_context. */
function buildParentContext(ctx: ExtensionContext): string {
  try {
    const entries = ctx.sessionManager?.getEntries?.() ?? [];
    const leafId = ctx.sessionManager?.getLeafId?.() ?? undefined;
    const messages = buildSessionContext(entries, leafId)
      .messages.filter((m: any) => m.role === "user" || m.role === "assistant")
      .slice(-MAX_PARENT_MESSAGES);
    if (messages.length === 0) return "";

    const lines: string[] = [];
    for (const m of messages as any[]) {
      const text = extractText(m.content).trim();
      if (!text) continue;
      lines.push(
        `## ${String(m.role).toUpperCase()}\n${truncate(text, MAX_PARENT_MESSAGE_CHARS)}`,
      );
    }
    if (lines.length === 0) return "";
    const body = truncate(lines.join("\n\n"), MAX_PARENT_CONTEXT_CHARS);
    return `<parent_context>\nThe following is a compact excerpt from the parent conversation. Use it as background only; your task is below.\n\n${body}\n</parent_context>\n\n`;
  } catch {
    return "";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}
