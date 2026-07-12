/**
 * manager.ts — Tracks agents and gates background concurrency.
 *
 * Foreground agents block the caller and bypass the queue. Background agents
 * run up to `maxConcurrent` at once; the rest queue and drain as slots free.
 */

import { randomUUID } from "node:crypto";
import { clampThinkingLevel } from "@earendil-works/pi-ai/compat";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type RunOptions,
  resolveModel,
  runChildSession,
} from "./child-session.ts";
import type { AgentRegistry } from "./registry.ts";
import {
  type AgentConfig,
  type AgentRecord,
  type SpawnOptions,
  SUBAGENT_INVOCATION_ENTRY,
  type SubagentInvocation,
  type SubagentType,
} from "./types.ts";

export type OnComplete = (record: AgentRecord) => void;

function resolveInvocation(
  ctx: ExtensionContext,
  config: AgentConfig,
  type: SubagentType,
  options: SpawnOptions,
): SubagentInvocation {
  const model =
    options.model ?? resolveModel(config.model, ctx.modelRegistry, ctx.model);
  const requestedThinking =
    options.thinkingLevel ??
    config.thinking ??
    SettingsManager.create(ctx.cwd, getAgentDir()).getDefaultThinkingLevel() ??
    "medium";
  const thinking = model ? clampThinkingLevel(model, requestedThinking) : "off";
  return {
    type,
    description: options.description,
    definitionPath: config.filePath,
    model: {
      value: model ? `${model.provider}/${model.id}` : "unavailable",
      source: options.model
        ? "tool override"
        : config.model
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
}

export class SubagentManager {
  private agents = new Map<string, AgentRecord>();
  private queue: QueuedSpawn[] = [];
  private runningBackground = 0;

  constructor(
    private registry: AgentRegistry,
    private maxConcurrent: number,
    private onComplete?: OnComplete,
    private onStart?: (r: AgentRecord) => void,
  ) {}

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

  /** Spawn an agent. Returns its id immediately (background) or after run (foreground via spawnAndWait). */
  spawn(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: SubagentType,
    prompt: string,
    options: SpawnOptions,
  ): string {
    const id = randomUUID().slice(0, 12);
    const config = this.registry.resolve(type);
    const record: AgentRecord = {
      id,
      type,
      description: options.description,
      invocation: resolveInvocation(ctx, config, type, options),
      status: options.isBackground ? "queued" : "running",
      turns: 0,
      toolUses: 0,
      startedAt: Date.now(),
      abortController: new AbortController(),
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    };
    this.agents.set(id, record);

    const queued: QueuedSpawn = { id, ctx, pi, config, type, prompt, options };
    if (options.isBackground && this.runningBackground >= this.maxConcurrent) {
      this.queue.push(queued);
      return id;
    }
    this.startAgent(queued, record);
    return id;
  }

  async spawnAndWait(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: SubagentType,
    prompt: string,
    options: Omit<SpawnOptions, "isBackground">,
  ): Promise<AgentRecord> {
    const id = this.spawn(pi, ctx, type, prompt, {
      ...options,
      isBackground: false,
    });
    const record = this.agents.get(id)!;
    await record.promise;
    return record;
  }

  private startAgent(q: QueuedSpawn, record: AgentRecord): void {
    record.status = "running";
    record.startedAt = Date.now();
    if (q.options.isBackground) this.runningBackground++;
    this.onStart?.(record);

    const runOpts: RunOptions = {
      pi: q.pi,
      agentId: q.id,
      model: q.options.model,
      maxTurns: q.options.maxTurns,
      thinkingLevel: q.options.thinkingLevel,
      inheritContext: q.options.inheritContext,
      signal: record.abortController!.signal,
    };
    // Wire parent abort → child abort.
    q.options.signal?.addEventListener("abort", () => this.abort(q.id), {
      once: true,
    });

    record.promise = runChildSession(q.ctx, q.config, q.prompt, runOpts, {
      onTurnEnd: (turns) => {
        record.turns = turns;
      },
      onToolActivity: (a) => {
        if (a.type === "end") record.toolUses++;
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
      .then(({ responseText, session, aborted, steered }) => {
        if (record.status !== "stopped") {
          record.status = aborted
            ? "aborted"
            : steered
              ? "steered"
              : "completed";
        }
        record.result = responseText;
        record.session = session;
        record.completedAt ??= Date.now();
        this.finishBackground(q, record);
        return responseText;
      })
      .catch((err) => {
        if (record.status !== "stopped") record.status = "error";
        record.error = err instanceof Error ? err.message : String(err);
        record.completedAt ??= Date.now();
        this.finishBackground(q, record);
        return "";
      });
  }

  private finishBackground(q: QueuedSpawn, record: AgentRecord): void {
    if (q.options.isBackground) {
      this.runningBackground--;
      try {
        this.onComplete?.(record);
      } catch {
        /* ignore */
      }
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    while (
      this.queue.length > 0 &&
      this.runningBackground < this.maxConcurrent
    ) {
      const next = this.queue.shift()!;
      const record = this.agents.get(next.id);
      if (!record || record.status !== "queued") continue;
      this.startAgent(next, record);
    }
  }

  async steer(id: string, message: string): Promise<boolean> {
    const record = this.agents.get(id);
    if (!record) return false;
    if (record.status !== "running") return false;
    if (record.session) {
      await record.session.steer(message);
    } else {
      (record.pendingSteers ??= []).push(message);
    }
    return true;
  }

  abort(id: string, opts?: { userAborted?: boolean }): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    if (opts?.userAborted) record.userAborted = true;
    if (record.status === "queued") {
      this.queue = this.queue.filter((q) => q.id !== id);
      record.status = "stopped";
      record.completedAt = Date.now();
      return true;
    }
    if (record.status !== "running") return false;
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

  /** Drop completed records (called on session start/switch). */
  clearCompleted(): void {
    for (const [id, r] of this.agents) {
      if (r.status === "running" || r.status === "queued") continue;
      r.session?.dispose?.();
      this.agents.delete(id);
    }
  }
}
