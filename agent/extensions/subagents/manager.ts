/**
 * manager.ts — Tracks asynchronous agents and gates concurrency.
 *
 * Agents run up to `maxConcurrent` at once; the rest queue and drain as slots
 * free.
 */

import { randomUUID } from "node:crypto";
import { clampThinkingLevel, type Model } from "@earendil-works/pi-ai/compat";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type RunOptions, runChildSession } from "./child-session.ts";
import { findModel, modelRef } from "./models.ts";
import { toolDetail } from "./recap.ts";
import type { AgentRegistry } from "./registry.ts";
import {
  type AgentConfig,
  type AgentRecord,
  type SendMode,
  type SendResult,
  type SpawnOptions,
  SUBAGENT_INVOCATION_ENTRY,
  type SubagentInvocation,
  type SubagentType,
} from "./types.ts";

export type ChildRunner = typeof runChildSession;

export interface SubagentObservers {
  onSpawn?: (record: AgentRecord) => void;
  onComplete?: (record: AgentRecord) => void;
}

/** The model a spawn will actually run on, plus its rendered invocation. */
interface ResolvedSpawn {
  invocation: SubagentInvocation;
  model?: Model<any>;
}

/**
 * Resolve one spawn's effective model and thinking level once, so the record,
 * the transcript snapshot, and the child session cannot disagree.
 *
 * An agent definition can name a model that is not available (its pinned
 * provider might be logged out, for example). Resolution then falls back to
 * the parent model. The source reads "inherited/default" instead of the
 * definition's name, because claiming the definition applied would hide the
 * fallback.
 */
function resolveSpawn(
  ctx: ExtensionContext,
  config: AgentConfig,
  type: SubagentType,
  options: SpawnOptions,
): ResolvedSpawn {
  const definitionModel = findModel(config.model, ctx.modelRegistry);
  const model = options.model ?? definitionModel ?? ctx.model;
  const requestedThinking =
    options.thinkingLevel ??
    config.thinking ??
    SettingsManager.create(ctx.cwd, getAgentDir()).getDefaultThinkingLevel() ??
    "medium";
  const thinking = model ? clampThinkingLevel(model, requestedThinking) : "off";
  return {
    model,
    invocation: {
      type,
      description: options.description,
      definitionPath: config.filePath,
      model: {
        value: model ? modelRef(model) : "unavailable",
        source: options.model
          ? "tool override"
          : definitionModel
            ? "agent definition"
            : "inherited/default",
      },
      thinking: {
        value: thinking,
        source: options.thinkingLevel
          ? "tool override"
          : config.thinking
            ? "agent definition"
            : "inherited/default",
      },
    },
  };
}

interface QueuedSpawn {
  id: string;
  ctx: ExtensionContext;
  pi: ExtensionAPI;
  config: AgentConfig;
  type: SubagentType;
  prompt: string;
  options: SpawnOptions;
  model?: Model<any>;
}

export class SubagentManager {
  private agents = new Map<string, AgentRecord>();
  private queue: QueuedSpawn[] = [];
  private slotHolders = new Set<string>();
  /** Resolvers for each record's settled promise, keyed by agent id. */
  private settleResolvers = new Map<string, () => void>();

  constructor(
    private registry: AgentRegistry,
    private maxConcurrent: number,
    private observers: SubagentObservers = {},
    private runChild: ChildRunner = runChildSession,
  ) {}

  setObservers(observers: SubagentObservers): void {
    this.observers = observers;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, n);
    this.drainQueue();
  }

  getRecord(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  hasRunning(): boolean {
    return [...this.agents.values()].some(
      (r) => r.status === "running" || r.status === "queued",
    );
  }

  /** Spawn an asynchronous agent and return its id immediately. */
  spawn(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: SubagentType,
    prompt: string,
    options: SpawnOptions,
  ): string {
    const id = randomUUID().slice(0, 12);
    const config = this.registry.resolve(type);
    const { invocation, model } = resolveSpawn(ctx, config, type, options);
    const record: AgentRecord = {
      id,
      type,
      description: options.description,
      invocation,
      status: "queued",
      awaitResult: options.awaitResult,
      turns: 0,
      toolUses: 0,
      startedAt: Date.now(),
      abortController: new AbortController(),
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    };
    // Resolved once the record's final state is written; a second resolve is
    // a harmless no-op.
    record.settled = new Promise<void>((resolve) =>
      this.settleResolvers.set(id, resolve),
    );
    this.agents.set(id, record);

    const queued: QueuedSpawn = {
      id,
      ctx,
      pi,
      config,
      type,
      prompt,
      options,
      model,
    };

    // Attach before queueing so an interrupted parent also cancels children
    // that have not reached a concurrency slot yet.
    if (options.signal?.aborted) {
      this.abort(id);
      return id;
    }
    options.signal?.addEventListener("abort", () => this.abort(id), {
      once: true,
    });

    if (this.slotHolders.size >= this.maxConcurrent) {
      this.queue.push(queued);
      this.observers.onSpawn?.(record);
      return id;
    }
    this.startAgent(queued, record);
    this.observers.onSpawn?.(record);
    return id;
  }

  private startAgent(q: QueuedSpawn, record: AgentRecord): void {
    record.status = "running";
    record.startedAt = Date.now();
    this.slotHolders.add(record.id);
    const activeTools = new Map<string, { name: string; detail?: string }>();

    const runOpts: RunOptions = {
      pi: q.pi,
      agentId: q.id,
      model: q.model,
      maxTurns: q.options.maxTurns,
      thinkingLevel: q.options.thinkingLevel,
      inheritContext: q.options.inheritContext,
      signal: record.abortController!.signal,
    };
    record.promise = this.runChild(q.ctx, q.config, q.prompt, runOpts, {
      onTurnEnd: (turns) => {
        record.turns = turns;
      },
      onToolActivity: (activity) => {
        if (activity.type === "start") {
          const tool = {
            name: activity.toolName,
            detail: toolDetail(activity.args),
          };
          activeTools.set(activity.toolCallId, tool);
          record.activeTool = tool;
          return;
        }
        if (activeTools.delete(activity.toolCallId)) record.toolUses++;
        record.activeTool = [...activeTools.values()].at(-1);
      },
      onAssistantUsage: (u) => {
        record.lifetimeUsage.input += u.input;
        record.lifetimeUsage.output += u.output;
        record.lifetimeUsage.cacheWrite += u.cacheWrite;
      },
      onTranscript: (file) => {
        record.transcriptFile = file;
      },
      onSessionCreated: (s) => {
        record.session = s;
        // Capture the actual post-clamp runtime values, then persist a snapshot
        // inside the child transcript for later /subagents browsing.
        if (s.model) {
          record.invocation.model.value = `${s.model.provider}/${s.model.id}`;
        }
        record.invocation.thinking.value = s.thinkingLevel;
        s.sessionManager.appendCustomEntry(
          SUBAGENT_INVOCATION_ENTRY,
          record.invocation,
        );
        // Flush steers that arrived before the session existed.
        if (record.pendingSteers?.length) {
          for (const m of record.pendingSteers) void s.steer(m).catch(() => {});
          record.pendingSteers = undefined;
        }
      },
    })
      .then(
        ({
          responseText,
          session,
          aborted,
          steered,
          stopReason,
          errorMessage,
        }) => {
          if (record.status !== "stopped") {
            // A provider failure resolves normally rather than throwing, so it
            // must be caught here or the record claims the child completed.
            record.status = aborted
              ? "aborted"
              : stopReason === "error"
                ? "error"
                : steered
                  ? "steered"
                  : "completed";
          }
          record.result = responseText;
          record.stopReason = stopReason;
          record.errorMessage = errorMessage;
          record.hitTurnLimit = steered;
          record.session = session;
          record.completedAt ??= Date.now();
          this.finishAgent(record);
          return responseText;
        },
      )
      .catch((err) => {
        if (record.status !== "stopped") record.status = "error";
        record.error = err instanceof Error ? err.message : String(err);
        record.completedAt ??= Date.now();
        this.finishAgent(record);
        return "";
      });
  }

  private finishAgent(record: AgentRecord): void {
    this.slotHolders.delete(record.id);
    record.activeTool = undefined;
    // Session switches can discard an aborted record before its run promise
    // settles. A record that is no longer tracked must not notify the new parent.
    if (this.agents.get(record.id) === record) {
      try {
        this.observers.onComplete?.(record);
      } catch {}
    } else {
      record.session?.dispose?.();
    }
    this.resolveSettled(record.id);
    this.drainQueue();
  }

  private drainQueue(): void {
    while (
      this.queue.length > 0 &&
      this.slotHolders.size < this.maxConcurrent
    ) {
      const next = this.queue.shift()!;
      const record = this.agents.get(next.id);
      if (!record || record.status !== "queued") continue;
      this.startAgent(next, record);
    }
  }

  /**
   * Resolves with the record once its final state is written, or undefined if
   * it was discarded (parent session switch) before settling.
   */
  whenSettled(id: string): Promise<AgentRecord | undefined> {
    const record = this.agents.get(id);
    if (!record?.settled) return Promise.resolve(undefined);
    return record.settled.then(() => this.agents.get(id));
  }

  private resolveSettled(id: string): void {
    const resolve = this.settleResolvers.get(id);
    if (!resolve) return;
    this.settleResolvers.delete(id);
    resolve();
  }

  private isSettled(record: AgentRecord): boolean {
    return Boolean(record.session && record.turns > 0 && record.session.isIdle);
  }

  /** Whether a child still accepts messages, using the live session as authority. */
  canSend(id: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    if (record.status !== "running" && record.status !== "queued") return false;
    return !this.isSettled(record);
  }

  /**
   * Deliver a message to a child, from the parent model or from a human.
   * Steering a settled session restarts it, so a finished child is rejected.
   */
  async send(id: string, message: string, mode: SendMode): Promise<SendResult> {
    const record = this.agents.get(id);
    if (!record)
      return { kind: "rejected", reason: `No agent with id "${id}".` };
    if (record.status !== "running" && record.status !== "queued") {
      return {
        kind: "rejected",
        reason: `Agent "${record.description}" is ${record.status} and cannot receive a message.`,
      };
    }
    // Queued, or running but still constructing its session: buffer it. The
    // child cannot act on a message before it has a turn to act in.
    if (!record.session) {
      (record.pendingSteers ??= []).push(message);
      return { kind: "queued" };
    }
    // Status can lag the final turn. A completed turn distinguishes a settled
    // session from a new session, which is also idle before its first turn.
    if (this.isSettled(record)) {
      return {
        kind: "rejected",
        reason: `Agent "${record.description}" has finished. Resuming it would overwrite its answer, so it cannot receive messages.`,
      };
    }
    if (mode === "followUp") await record.session.followUp(message);
    else await record.session.steer(message);
    return { kind: "delivered", mode };
  }

  abort(id: string, opts?: { userAborted?: boolean }): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    if (record.status === "queued") {
      if (opts?.userAborted) record.userAborted = true;
      this.queue = this.queue.filter((q) => q.id !== id);
      record.status = "stopped";
      record.completedAt = Date.now();
      // Nothing else settles a queued record.
      this.resolveSettled(id);
      return true;
    }
    if (record.status !== "running") return false;
    if (this.isSettled(record)) return false;
    if (opts?.userAborted) record.userAborted = true;
    record.abortController?.abort();
    record.status = "stopped";
    record.completedAt = Date.now();
    return true;
  }

  abortAll(): void {
    for (const q of this.queue) {
      const r = this.agents.get(q.id);
      if (r) {
        r.status = "stopped";
        r.completedAt = Date.now();
        this.resolveSettled(q.id);
      }
    }
    this.queue = [];
    for (const r of this.agents.values()) {
      if (r.status === "running") {
        r.abortController?.abort();
        r.status = "stopped";
        r.completedAt = Date.now();
      }
    }
  }

  /**
   * Abort and forget every record without disposing a child whose abort is still
   * settling. Detached running sessions dispose themselves in finishAgent().
   */
  abortAndDiscardAll(): void {
    // Detach resolvers so abortAll() wakes nobody; after the clear below,
    // every waiter resolves with undefined, which reports the discard.
    const detached = new Map(this.settleResolvers);
    this.settleResolvers.clear();
    this.abortAll();
    // Settled sessions have no later finishAgent() call to dispose them. Active
    // sessions dispose there after their abort settles.
    for (const record of this.agents.values()) {
      if (!this.slotHolders.has(record.id)) record.session?.dispose?.();
    }
    this.queue = [];
    this.agents.clear();
    for (const resolve of detached.values()) resolve();
    // Detached runs no longer consume slots in the replacement session.
    this.slotHolders.clear();
  }

  /** Drop completed records. */
  clearCompleted(): void {
    for (const [id, r] of this.agents) {
      if (r.status === "running" || r.status === "queued") continue;
      r.session?.dispose?.();
      this.agents.delete(id);
    }
  }
}
