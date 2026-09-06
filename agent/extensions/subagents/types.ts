/**
 * Core type definitions for the subagents plugin.
 *
 * Small subagent core: spawn / steer / get-result, markdown agent types,
 * and static tool allowlists. No worktrees, scheduling, memory, or RPC.
 */

import type { Model, ThinkingLevel } from "@earendil-works/pi-ai/compat";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

export type { ThinkingLevel };

/**
 * Thinking levels a spawn may request, ascending. `satisfies` keeps every entry
 * a real `ThinkingLevel`; a level pi adds later is simply not offered until it
 * is listed here. "off" is absent because a session's level cannot be off.
 */
export const THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[];

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

/** Agent type name, backed by a global or project agent markdown file. */
export type SubagentType = string;

/** Where an effective invocation setting came from. */
export type InvocationSettingSource =
  "tool override" | "agent definition" | "inherited/default" | "unknown";

/** One effective invocation setting plus its provenance. */
export interface InvocationSetting {
  value: string;
  source: InvocationSettingSource;
}

export function settingSourceLabel(setting: InvocationSetting): string {
  switch (setting.source) {
    case "tool override":
      return "override";
    case "agent definition":
      return "definition";
    case "inherited/default":
      return "inherited";
    default:
      return "unknown";
  }
}

/** Resolved execution metadata captured when a subagent is spawned. */
export interface SubagentInvocation {
  type: SubagentType;
  description: string;
  definitionPath?: string;
  model: InvocationSetting;
  thinking: InvocationSetting;
}

/** Custom child-session entry used to persist exact invocation metadata. */
export const SUBAGENT_INVOCATION_ENTRY = "subagent-invocation";

/** How a message reaches a running child. */
export type SendMode = "steer" | "followUp";

/** `queued` means the message has not reached the child's context. */
export type SendResult =
  | { kind: "delivered"; mode: SendMode }
  | { kind: "queued" }
  | { kind: "rejected"; reason: string };

/** Agent run state. */
export type SubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "steered"
  | "aborted"
  | "stopped"
  | "error";

const STATUS_ICONS: Record<string, string> = {
  running: "●",
  queued: "◌",
  completed: "✓",
  steered: "✓",
  error: "✗",
  aborted: "✗",
  stopped: "■",
  "on disk": "○",
};

export const statusIcon = (status: string): string =>
  STATUS_ICONS[status] ?? "·";

export const SUBAGENTS_DISABLED_MESSAGE =
  "Subagents are disabled. Run /toggle-subagents to enable them.";

/** Resolved config loaded from agents/<name>.md. */
export interface AgentConfig {
  name: string;
  /** Absolute path to the agents/<name>.md definition file. */
  filePath: string;
  displayName?: string;
  description: string;
  /** Undefined allows all tools. An empty list allows none. */
  allowTools?: string[];
  /** Fuzzy/explicit model, e.g. "anthropic/claude-haiku-4-5" or "haiku". */
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  /** Agent instructions from the markdown body. */
  systemPrompt: string;
  /**
   * "replace" — env header + systemPrompt, no parent identity.
   * "append"  — parent system prompt + bridge + env + systemPrompt.
   */
  promptMode: "replace" | "append";
  /** false = hidden from spawning. */
  enabled?: boolean;
  /** Where this config came from. */
  source?: "project" | "global";
}

/** Lifetime token accounting, accumulated across the child session. */
export interface LifetimeUsage {
  input: number;
  output: number;
  cacheWrite: number;
}

/** Live, mutable record tracking one spawned agent. */
export interface AgentRecord {
  id: string;
  type: SubagentType;
  description: string;
  invocation: SubagentInvocation;
  status: SubagentStatus;
  result?: string;
  error?: string;
  /** Stop reason of the child's last assistant message, when it produced one. */
  stopReason?: string;
  /** Untrusted provider text. Never surface directly; see termination.ts. */
  errorMessage?: string;
  /** Reached its turn limit, whether or not the at-limit steer was sent. */
  hitTurnLimit?: boolean;
  /** Completed model turns in this child session. */
  turns: number;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  session?: AgentSession;
  abortController?: AbortController;
  /** Messages that enter as steers before the initial prompt starts. */
  pendingSteers?: string[];
  lifetimeUsage: LifetimeUsage;
  /** Path to the persisted transcript JSONL, for audit. */
  transcriptFile?: string;
  /** The most recently started tool call that is still active. */
  activeTool?: { name: string; detail?: string };
  /**
   * Resolves with the record once its final state (status, result, stopReason)
   * is written, or with undefined if the record was discarded first.
   */
  settled: Promise<AgentRecord | undefined>;
  settle: (result: AgentRecord | undefined) => void;
  /** Whether the user has seen this failure. */
  widgetAcknowledged?: boolean;
  /** Whether the user stopped this agent. */
  userAborted?: boolean;
  /**
   * The blocking tool call delivered this record's result; do not notify.
   */
  awaitResult?: boolean;
}

/** Per-spawn options handed to the manager. */
export interface SpawnOptions {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  thinkingLevel?: ThinkingLevel;
  /** Prepend a compact recent excerpt from the parent conversation. */
  inheritContext?: boolean;
  /** Block the spawning tool call until the agent settles (the `wait` parameter). */
  awaitResult?: boolean;
  /** Parent abort signal — aborts the child when the parent turn is interrupted. */
  signal?: AbortSignal;
}
