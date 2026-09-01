/**
 * child-session.ts — Construct and run a child pi AgentSession.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai/compat";
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
import { SUPPRESS_AGENT_END_NOTIFICATION_ENTRY } from "../../lib/session-notification-policy.ts";
import { textContent } from "./content.ts";
import { detectEnv } from "./env.ts";
import {
  DENIED_TOOLS,
  filterActiveTools,
  resolveAllowedTools,
} from "./gating.ts";
import { buildAgentPrompt } from "./prompts.ts";
import { type TurnOutcome, willContinue } from "./steer-guard.ts";
import type { AgentConfig, ThinkingLevel } from "./types.ts";

/** Streaming callbacks the manager wires to a record + widget. */
export interface RunCallbacks {
  /** `args` is present only on "start", where it identifies the call. */
  onToolActivity?: (
    a:
      | {
          type: "start";
          toolCallId: string;
          toolName: string;
          args: unknown;
        }
      | { type: "end"; toolCallId: string; toolName: string },
  ) => void;
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
  /** Effective model, resolved by the manager. Undefined uses the session default. */
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
  /** Why the child's last assistant message ended, for termination reporting. */
  stopReason?: string;
  /** Raw provider error. Sanitize before surfacing; see termination.ts. */
  errorMessage?: string;
}

/**
 * Persist child transcripts under `<sessionDir>/subagents/<parentSessionId>/`.
 * This makes ownership structural: every session's children live in their
 * own folder, instead of sharing one flat dir filtered by header.
 *
 * This function falls back to a temp dir in headless mode, when no parent
 * dir or id is available.
 */
export function deriveChildSessionDir(
  ctx: ExtensionContext,
  parentSessionId: string | undefined,
): string {
  try {
    const parentDir = ctx.sessionManager?.getSessionDir?.();
    if (parentDir && parentSessionId)
      return join(parentDir, "subagents", parentSessionId);
  } catch {
    // headless / --no-session: no parent dir available
  }
  return join(tmpdir(), "pi-subagents-sessions");
}

/**
 * Normalize max turns. undefined/0 -> unlimited; else a whole number >= 1.
 *
 * The tool schema accepts any number, so this function floors it. The turn
 * counter only ever hits integers, so a budget of 2.5 becomes a budget of 2.
 */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
  if (n == null || !Number.isFinite(n) || n === 0) return undefined;
  return Math.max(1, Math.floor(n));
}

export async function runChildSession(
  ctx: ExtensionContext,
  config: AgentConfig,
  prompt: string,
  options: RunOptions,
  callbacks: RunCallbacks,
): Promise<RunResult> {
  // Attach before the body's first await: AbortSignal does not replay, so a
  // listener registered after the async construction would miss an abort
  // during it. The finally removes it on every path, including failures.
  const liveSessionRef: { session?: AgentSession } = {};
  const onAbort = () => void liveSessionRef.session?.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await runChildSessionBody(
      ctx,
      config,
      prompt,
      options,
      callbacks,
      liveSessionRef,
    );
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

async function runChildSessionBody(
  ctx: ExtensionContext,
  config: AgentConfig,
  prompt: string,
  options: RunOptions,
  callbacks: RunCallbacks,
  liveSessionRef: { session?: AgentSession },
): Promise<RunResult> {
  const cwd = ctx.cwd;
  const env = await detectEnv(options.pi, cwd);
  const systemPrompt = buildAgentPrompt(
    config,
    cwd,
    env,
    ctx.getSystemPrompt(),
  );

  // Point 1: gate built-ins and the initial active set. `undefined` means every
  // tool, which pi reads as "default built-ins plus all extension tools".
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

  // Child transcripts are pi-native JSONL, linked to the current session.
  // Headless mode falls back to a temp dir.
  let parentSessionId: string | undefined;
  try {
    parentSessionId = ctx.sessionManager?.getSessionId?.();
  } catch {
    parentSessionId = undefined;
  }
  const sessionDir = deriveChildSessionDir(ctx, parentSessionId);
  const sessionManager = SessionManager.create(cwd, sessionDir, {
    parentSession: parentSessionId,
  });
  // The parent reports child completion. Suppress this session's own desktop
  // notification without coupling notification policy to prompt contents.
  sessionManager.appendCustomEntry(SUPPRESS_AGENT_END_NOTIFICATION_ENTRY);
  const transcriptFile = sessionManager.getSessionFile();
  callbacks.onTranscript?.(transcriptFile);

  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    sessionManager,
    settingsManager: SettingsManager.create(cwd, getAgentDir()),
    model: options.model,
    ...(tools ? { tools } : {}), // 1. explicit allowlist, when there is one
    // The denylist is pi's to enforce too, not only ours below.
    excludeTools: [...DENIED_TOOLS],
    resourceLoader: loader,
    ...((options.thinkingLevel ?? config.thinking)
      ? { thinkingLevel: options.thinkingLevel ?? config.thinking }
      : {}),
  });
  liveSessionRef.session = session;

  session.setSessionName(
    `${config.displayName ?? config.name}#${options.agentId.slice(0, 8)}`,
  );

  // Bind extensions so extension tools register.
  await session.bindExtensions({});

  // 2. Extension tools register only after bindExtensions, so this step
  // re-applies both rules.
  //
  // Without an allowlist, this activates every registered tool except denied
  // tools. Pi's default active set is only read/bash/edit/write, so "every
  // tool" requires an explicit request; it is not the default.
  const active = session.getActiveToolNames();
  const candidates = tools
    ? active
    : session.getAllTools().map((tool) => tool.name);
  const guarded = filterActiveTools(candidates, config);
  const changed =
    guarded.length !== active.length ||
    guarded.some((name, i) => name !== active[i]);
  if (changed) session.setActiveToolsByName(guarded);

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
  let lastStopReason: string | undefined;
  let lastErrorMessage: string | undefined;

  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "turn_end") {
      turnCount++;
      callbacks.onTurnEnd?.(turnCount);
      if (maxTurns != null) {
        const outcome = (event.message as { stopReason?: TurnOutcome })
          .stopReason;
        // Latched on reaching the limit, not on steering, so a child that
        // stopped on its own still reaches the grace abort below.
        if (!softLimitReached && turnCount >= maxTurns) {
          softLimitReached = true;
          // Steering a settled session restarts it, so only nudge a child that
          // was going to take another turn regardless.
          if (willContinue(outcome)) {
            void session.steer(
              "You have reached your turn limit. Wrap up immediately — provide your final answer now.",
            );
          }
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
      callbacks.onToolActivity?.({
        type: "start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      });
    }
    if (event.type === "tool_execution_end") {
      callbacks.onToolActivity?.({
        type: "end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      // A provider failure does not throw; it arrives here instead.
      const m = event.message as { stopReason?: string; errorMessage?: string };
      lastStopReason = m.stopReason;
      lastErrorMessage = m.errorMessage;
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

  // An abort during construction must not start a turn; upstream already
  // marked the record stopped.
  if (options.signal?.aborted) {
    unsub();
    return { responseText: "", session, aborted: false, steered: false };
  }

  // inherit_context: prepend a compact parent transcript (optional, off by default).
  const effectivePrompt = options.inheritContext
    ? buildParentContext(ctx) + prompt
    : prompt;

  try {
    await session.prompt(effectivePrompt);
  } finally {
    unsub();
  }

  const responseText = lastFullText.trim() || getLastAssistantText(session);
  return {
    responseText,
    session,
    aborted,
    steered: softLimitReached,
    stopReason: lastStopReason,
    errorMessage: lastErrorMessage,
  };
}

function getLastAssistantText(session: AgentSession): string {
  const msgs = session.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "assistant") continue;
    const text = textContent((m as any).content).trim();
    if (text) return text;
  }
  return "";
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
      const text = textContent(m.content).trim();
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
