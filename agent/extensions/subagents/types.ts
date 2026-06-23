/**
 * Core type definitions for the subagents plugin.
 *
 * Small subagent core: spawn / steer / get-result, markdown agent types,
 * and static tool allowlists. No worktrees, scheduling, memory, or RPC.
 */

import type { Model, ThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

export type { ThinkingLevel };

/** Agent type name, backed by a global or project .pi/agents/<name>.md file. */
export type SubagentType = string;

/** Agent run state. */
export type SubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "steered"
  | "aborted"
  | "stopped"
  | "error";

/**
 * Resolved config for one agent type, loaded from agents/<name>.md.
 */
export interface AgentConfig {
  name: string;
  displayName?: string;
  description: string;
  allowTools: string[];
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
  status: SubagentStatus;
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  session?: AgentSession;
  abortController?: AbortController;
  promise?: Promise<string>;
  /** Steering messages that arrived before the session was ready. */
  pendingSteers?: string[];
  lifetimeUsage: LifetimeUsage;
  /** Path to the persisted transcript JSONL, for audit. */
  transcriptFile?: string;
}

/** Per-spawn options handed to the manager. */
export interface SpawnOptions {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  thinkingLevel?: ThinkingLevel;
  /** Prepend a compact recent excerpt from the parent conversation. */
  inheritContext?: boolean;
  isBackground?: boolean;
  /** Parent abort signal — aborts the child when the parent turn is interrupted. */
  signal?: AbortSignal;
}
