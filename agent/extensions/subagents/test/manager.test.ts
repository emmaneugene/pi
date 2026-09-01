import type { Model } from "@earendil-works/pi-ai/compat";
import type {
  AgentSession,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { AgentRegistry } from "../registry.ts";
import { type ChildRunner, SubagentManager } from "../manager.ts";
import type { AgentConfig, ThinkingLevel } from "../types.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const config: AgentConfig = {
  name: "test",
  filePath: "/agents/test.md",
  description: "test agent",
  allowTools: [],
  systemPrompt: "test",
  promptMode: "replace",
};

const registry = {
  resolve: () => config,
} as unknown as AgentRegistry;
const pi = {} as ExtensionAPI;
const ctx = {
  model: undefined,
  modelRegistry: {},
  cwd: "/tmp",
} as ExtensionContext;
const options = (signal?: AbortSignal) => ({
  description: "test run",
  thinkingLevel: "off" as ThinkingLevel,
  signal,
});

type RunResult = Awaited<ReturnType<ChildRunner>>;
const completed = (): RunResult => ({
  responseText: "done",
  session: {} as AgentSession,
  aborted: false,
  steered: false,
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const SONNET = {
  provider: "anthropic",
  id: "claude-sonnet-5",
  reasoning: true,
} as unknown as Model<any>;

/** A ctx whose registry offers exactly one model, for provenance assertions. */
function ctxWith(agentConfig: Partial<AgentConfig>) {
  const modelCtx = {
    model: SONNET,
    cwd: "/tmp",
    modelRegistry: {
      getAvailable: () => [SONNET],
      find: (provider: string, id: string) =>
        provider === SONNET.provider && id === SONNET.id ? SONNET : undefined,
    },
  } as unknown as ExtensionContext;
  const agentRegistry = {
    resolve: () => ({ ...config, ...agentConfig }),
  } as unknown as AgentRegistry;
  const manager = new SubagentManager(agentRegistry, 1, {}, async () =>
    completed(),
  );
  return { ctx: modelCtx, manager };
}

describe("SubagentManager invocation provenance", () => {
  it("honours a thinking override and records it as one", () => {
    const { ctx: modelCtx, manager } = ctxWith({ thinking: "low" });

    const id = manager.spawn(pi, modelCtx, "test", "work", {
      description: "thinking override",
      thinkingLevel: "xhigh",
    });

    // Sonnet maps no xhigh level, so the clamp is visible in the record.
    expect(manager.getRecord(id)?.invocation.thinking).toEqual({
      value: "high",
      source: "tool override",
    });
  });

  it("credits the agent definition only when its model resolves", () => {
    const resolved = ctxWith({ model: "sonnet" });
    const missing = ctxWith({ model: "anthropic/claude-opus-9" });

    const withModel = resolved.manager.spawn(pi, resolved.ctx, "test", "work", {
      description: "definition model",
    });
    const withoutModel = missing.manager.spawn(
      pi,
      missing.ctx,
      "test",
      "work",
      { description: "unavailable definition model" },
    );

    expect(resolved.manager.getRecord(withModel)?.invocation.model).toEqual({
      value: "anthropic/claude-sonnet-5",
      source: "agent definition",
    });
    // Fell back to the parent model, so it must not claim the definition applied.
    expect(missing.manager.getRecord(withoutModel)?.invocation.model).toEqual({
      value: "anthropic/claude-sonnet-5",
      source: "inherited/default",
    });
  });
});

describe("SubagentManager asynchronous scheduling", () => {
  it("returns immediately, queues over capacity, and drains in order", async () => {
    const runs: Array<ReturnType<typeof deferred<RunResult>>> = [];
    const started: string[] = [];
    const runner: ChildRunner = async (_ctx, _config, prompt) => {
      started.push(prompt);
      const run = deferred<RunResult>();
      runs.push(run);
      return run.promise;
    };
    const manager = new SubagentManager(registry, 1, {}, runner);

    const first = manager.spawn(pi, ctx, "test", "first", options());
    const second = manager.spawn(pi, ctx, "test", "second", options());
    const third = manager.spawn(pi, ctx, "test", "third", options());

    expect(first).toEqual(expect.any(String));
    expect(started).toEqual(["first"]);
    expect(manager.getRecord(first)?.status).toBe("running");
    expect(manager.getRecord(second)?.status).toBe("queued");
    expect(manager.getRecord(third)?.status).toBe("queued");

    expect(manager.abort(second)).toBe(true);
    runs[0].resolve(completed());
    await settle();

    expect(started).toEqual(["first", "third"]);
    expect(manager.getRecord(second)?.status).toBe("stopped");
    expect(manager.getRecord(third)?.status).toBe("running");

    runs[1].resolve(completed());
    await settle();
  });

  it("cancels a queued child when its parent signal aborts", async () => {
    const runs: Array<ReturnType<typeof deferred<RunResult>>> = [];
    const started: string[] = [];
    const runner: ChildRunner = async (_ctx, _config, prompt) => {
      started.push(prompt);
      const run = deferred<RunResult>();
      runs.push(run);
      return run.promise;
    };
    const manager = new SubagentManager(registry, 1, {}, runner);
    const parent = new AbortController();

    manager.spawn(pi, ctx, "test", "running", options());
    const queued = manager.spawn(
      pi,
      ctx,
      "test",
      "must not start",
      options(parent.signal),
    );
    parent.abort();

    expect(manager.getRecord(queued)?.status).toBe("stopped");
    runs[0].resolve(completed());
    await settle();
    expect(started).toEqual(["running"]);
  });

  it("does not start a child whose parent signal is already aborted", () => {
    const runner: ChildRunner = async () => completed();
    const manager = new SubagentManager(registry, 1, {}, runner);
    const parent = new AbortController();
    parent.abort();

    const id = manager.spawn(
      pi,
      ctx,
      "test",
      "never starts",
      options(parent.signal),
    );

    expect(manager.getRecord(id)?.status).toBe("stopped");
    expect(manager.getRecord(id)?.promise).toBeUndefined();
  });
});

describe("SubagentManager blocking spawns", () => {
  it("resolves whenSettled with the settled record and flags it awaited", async () => {
    const run = deferred<RunResult>();
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async () => run.promise,
    );

    const id = manager.spawn(pi, ctx, "test", "work", {
      ...options(),
      awaitResult: true,
    });
    expect(manager.getRecord(id)?.awaitResult).toBe(true);

    const settled = manager.whenSettled(id);
    run.resolve(completed());

    await expect(settled).resolves.toMatchObject({
      status: "completed",
      result: "done",
    });
  });

  it("does not flag a background spawn as awaited", () => {
    const manager = new SubagentManager(registry, 1, {}, async () =>
      completed(),
    );

    const id = manager.spawn(pi, ctx, "test", "work", options());

    expect(manager.getRecord(id)?.awaitResult).toBeUndefined();
  });

  it("resolves a blocked waiter when a queued child is aborted", async () => {
    const first = deferred<RunResult>();
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async (_ctx, _config, prompt) =>
        prompt === "first" ? first.promise : completed(),
    );
    manager.spawn(pi, ctx, "test", "first", options());
    const queued = manager.spawn(pi, ctx, "test", "second", {
      ...options(),
      awaitResult: true,
    });
    const settled = manager.whenSettled(queued);

    manager.abort(queued);

    // Queued records have no run promise; the waiter must not hang on one.
    await expect(settled).resolves.toMatchObject({ status: "stopped" });
  });

  it("resolves a blocked waiter with undefined when the record is discarded", async () => {
    const run = deferred<RunResult>();
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async () => run.promise,
    );

    const id = manager.spawn(pi, ctx, "test", "work", {
      ...options(),
      awaitResult: true,
    });
    const settled = manager.whenSettled(id);

    manager.abortAndDiscardAll();

    await expect(settled).resolves.toBeUndefined();
  });

  it("resolves a blocked queued waiter with undefined when discarded", async () => {
    const first = deferred<RunResult>();
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async (_ctx, _config, prompt) =>
        prompt === "first" ? first.promise : completed(),
    );
    manager.spawn(pi, ctx, "test", "first", options());
    const queued = manager.spawn(pi, ctx, "test", "second", {
      ...options(),
      awaitResult: true,
    });
    const settled = manager.whenSettled(queued);

    manager.abortAndDiscardAll();

    // abortAll() must not hand a blocked tool a stopped record from a cleared map.
    await expect(settled).resolves.toBeUndefined();
  });

  it("resolves a late waiter only when the aborted run settles", async () => {
    const run = deferred<RunResult>();
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async () => run.promise,
    );

    const id = manager.spawn(pi, ctx, "test", "work", {
      ...options(),
      awaitResult: true,
    });
    manager.abort(id);
    // Registered after the abort: the result fields are not written until the
    // run settles.
    let resolved = false;
    const settled = manager.whenSettled(id).then((r) => {
      resolved = true;
      return r;
    });
    await settle();
    // A status-polling implementation would have resolved immediately here.
    expect(resolved).toBe(false);
    run.resolve(completed());

    await expect(settled).resolves.toMatchObject({
      status: "stopped",
      result: "done",
    });
  });

  it("resolves immediately for an already-settled record", async () => {
    const manager = new SubagentManager(registry, 1, {}, async () =>
      completed(),
    );

    const id = manager.spawn(pi, ctx, "test", "work", options());
    await settle();

    await expect(manager.whenSettled(id)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("settle waiters survive an unrelated agent finishing first", async () => {
    // The queue drains in order; a waiter on the second child must still be
    // pending after the first child settles.
    const first = deferred<RunResult>();
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async (_ctx, _config, prompt) =>
        prompt === "first" ? first.promise : completed(),
    );
    manager.spawn(pi, ctx, "test", "first", options());
    const second = manager.spawn(pi, ctx, "test", "second", {
      ...options(),
      awaitResult: true,
    });
    const settled = manager.whenSettled(second);

    first.resolve(completed());
    await settle();
    expect(manager.getRecord(second)?.status).toBe("running");

    await expect(settled).resolves.toMatchObject({ status: "completed" });
  });
});

/**
 * A child session recording what the manager delivers to it. `sessionManager`
 * and `thinkingLevel` are present because the manager writes an invocation
 * snapshot into every child transcript on creation.
 */
function recordingSession() {
  const steers: string[] = [];
  const followUps: string[] = [];
  const state = { isIdle: false };
  const session = {
    thinkingLevel: "off",
    sessionManager: { appendCustomEntry: () => undefined },
    get isIdle() {
      return state.isIdle;
    },
    steer: async (text: string) => {
      steers.push(text);
    },
    followUp: async (text: string) => {
      followUps.push(text);
    },
  } as unknown as AgentSession;
  return { session, steers, followUps, state };
}

describe("SubagentManager.send", () => {
  /** Start one agent and hand back its live session plus the run's resolver. */
  function running() {
    const spy = recordingSession();
    const run = deferred<RunResult>();
    const runner: ChildRunner = async (_ctx, _config, _prompt, _opts, cbs) => {
      cbs.onSessionCreated?.(spy.session);
      return run.promise;
    };
    const manager = new SubagentManager(registry, 1, {}, runner);
    const id = manager.spawn(pi, ctx, "test", "work", options());
    return { manager, id, spy, run };
  }

  it("steers a running child and reports delivery", async () => {
    const { manager, id, spy } = running();

    await expect(manager.send(id, "look at auth", "steer")).resolves.toEqual({
      kind: "delivered",
      mode: "steer",
    });
    expect(spy.steers).toEqual(["look at auth"]);
    expect(spy.followUps).toEqual([]);
  });

  it("routes a follow-up to followUp, not steer", async () => {
    const { manager, id, spy } = running();

    await expect(
      manager.send(id, "then check tests", "followUp"),
    ).resolves.toEqual({ kind: "delivered", mode: "followUp" });
    expect(spy.followUps).toEqual(["then check tests"]);
    expect(spy.steers).toEqual([]);
  });

  it("buffers a message for a queued child and flushes it on start", async () => {
    const spies = [recordingSession(), recordingSession()];
    const runs = [deferred<RunResult>(), deferred<RunResult>()];
    let started = 0;
    const runner: ChildRunner = async (_ctx, _config, _prompt, _opts, cbs) => {
      const index = started++;
      cbs.onSessionCreated?.(spies[index]!.session);
      return runs[index]!.promise;
    };
    const manager = new SubagentManager(registry, 1, {}, runner);
    manager.spawn(pi, ctx, "test", "first", options());
    const queued = manager.spawn(pi, ctx, "test", "second", options());

    expect(manager.getRecord(queued)?.status).toBe("queued");
    await expect(
      manager.send(queued, "mind the schema", "steer"),
    ).resolves.toEqual({ kind: "queued" });
    // Nothing delivered yet: the child has no turn to receive it in.
    expect(spies[1]!.steers).toEqual([]);

    runs[0]!.resolve(completed());
    await settle();

    expect(spies[1]!.steers).toEqual(["mind the schema"]);
  });

  it("rejects a settled child instead of waking it", async () => {
    const { manager, id, spy, run } = running();
    run.resolve(completed());
    await settle();

    const result = await manager.send(id, "one more thing", "steer");

    expect(result.kind).toBe("rejected");
    expect(result).toMatchObject({
      reason: expect.stringContaining("completed"),
    });
    expect(spy.steers).toEqual([]);
  });

  it("rejects a child that was stopped by the user", async () => {
    const { manager, id, spy } = running();
    manager.abort(id, { userAborted: true });

    expect((await manager.send(id, "carry on", "steer")).kind).toBe("rejected");
    expect(spy.steers).toEqual([]);
  });

  it("rejects an unknown id", async () => {
    const { manager } = running();

    await expect(manager.send("nope", "hello", "steer")).resolves.toMatchObject(
      {
        kind: "rejected",
        reason: expect.stringContaining("nope"),
      },
    );
  });

  it("refuses a session that has settled while the record still says running", async () => {
    // Status can remain "running" after the session becomes idle.
    const { manager, id, spy } = running();
    manager.getRecord(id)!.turns = 3;
    spy.state.isIdle = true;

    const result = await manager.send(id, "one more thing", "steer");

    expect(manager.getRecord(id)?.status).toBe("running");
    expect(result.kind).toBe("rejected");
    expect(spy.steers).toEqual([]);
    expect(spy.followUps).toEqual([]);
  });

  it("refuses a settled session for a follow-up too, not just a steer", async () => {
    const { manager, id, spy } = running();
    manager.getRecord(id)!.turns = 3;
    spy.state.isIdle = true;

    expect((await manager.send(id, "later", "followUp")).kind).toBe("rejected");
    expect(spy.followUps).toEqual([]);
  });

  it("delivers to a child that is starting up and has no turn yet", async () => {
    // isIdle is true before the first turn too, so turns==0 must not be read as
    // settled: rejecting here would claim a child that never ran had finished.
    const { manager, id, spy } = running();
    spy.state.isIdle = true;

    expect(manager.getRecord(id)?.turns).toBe(0);
    await expect(manager.send(id, "start with lib/", "steer")).resolves.toEqual(
      {
        kind: "delivered",
        mode: "steer",
      },
    );
    expect(spy.steers).toEqual(["start with lib/"]);
  });

  it("delivers mid-run, when a tool-use loop keeps the session active", async () => {
    const { manager, id, spy } = running();
    manager.getRecord(id)!.turns = 2;
    spy.state.isIdle = false;

    await expect(
      manager.send(id, "check the tests too", "steer"),
    ).resolves.toEqual({ kind: "delivered", mode: "steer" });
    expect(spy.steers).toEqual(["check the tests too"]);
  });

  it("reports precise availability during the settled-status lag", () => {
    const { manager, id, spy } = running();
    manager.getRecord(id)!.turns = 1;
    spy.state.isIdle = true;

    expect(manager.getRecord(id)?.status).toBe("running");
    expect(manager.canSend(id)).toBe(false);
  });
});

describe("SubagentManager lifecycle cleanup", () => {
  it("does not relabel an idle completed turn as user-stopped", () => {
    const spy = recordingSession();
    const run = deferred<RunResult>();
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async (_ctx, _config, _prompt, _opts, callbacks) => {
        callbacks.onSessionCreated?.(spy.session);
        return run.promise;
      },
    );
    const id = manager.spawn(pi, ctx, "test", "work", options());
    const record = manager.getRecord(id)!;
    record.turns = 1;
    spy.state.isIdle = true;

    expect(manager.abort(id, { userAborted: true })).toBe(false);
    expect(record.status).toBe("running");
    expect(record.userAborted).toBeUndefined();
  });

  it("suppresses completion after a session discards an aborted child", async () => {
    const run = deferred<RunResult>();
    const onComplete = vi.fn();
    const dispose = vi.fn();
    const session = { dispose } as unknown as AgentSession;
    const manager = new SubagentManager(
      registry,
      1,
      { onComplete },
      async () => run.promise,
    );

    manager.spawn(pi, ctx, "test", "work", options());
    manager.abortAndDiscardAll();
    run.resolve({ ...completed(), session });
    await settle();

    expect(manager.listAgents()).toEqual([]);
    expect(onComplete).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes an already-settled session when all records are discarded", async () => {
    const dispose = vi.fn();
    const session = { dispose } as unknown as AgentSession;
    const manager = new SubagentManager(registry, 1, {}, async () => ({
      ...completed(),
      session,
    }));

    manager.spawn(pi, ctx, "test", "work", options());
    await settle();
    manager.abortAndDiscardAll();

    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.listAgents()).toEqual([]);
  });

  it("releases discarded runs from the replacement session's concurrency budget", () => {
    const first = deferred<RunResult>();
    const started: string[] = [];
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async (_ctx, _config, prompt) => {
        started.push(prompt);
        return prompt === "old" ? first.promise : completed();
      },
    );

    manager.spawn(pi, ctx, "test", "old", options());
    manager.abortAndDiscardAll();
    const replacement = manager.spawn(pi, ctx, "test", "new", options());

    expect(started).toEqual(["old", "new"]);
    expect(manager.getRecord(replacement)?.status).toBe("running");
  });

  it("keeps another parallel tool visible when the first call ends", () => {
    const run = deferred<RunResult>();
    let callbacks!: Parameters<ChildRunner>[4];
    const manager = new SubagentManager(
      registry,
      1,
      {},
      async (_ctx, _config, _prompt, _opts, runCallbacks) => {
        callbacks = runCallbacks;
        return run.promise;
      },
    );
    const id = manager.spawn(pi, ctx, "test", "work", options());
    const record = manager.getRecord(id)!;

    callbacks.onToolActivity?.({
      type: "end",
      toolCallId: "missing",
      toolName: "read",
    });
    expect(record.toolUses).toBe(0);

    callbacks.onToolActivity?.({
      type: "start",
      toolCallId: "read-1",
      toolName: "read",
      args: { path: "one.ts" },
    });
    callbacks.onToolActivity?.({
      type: "start",
      toolCallId: "bash-1",
      toolName: "bash",
      args: { command: "npm test" },
    });
    callbacks.onToolActivity?.({
      type: "end",
      toolCallId: "read-1",
      toolName: "read",
    });

    expect(record.activeTool).toEqual({ name: "bash", detail: "npm test" });
    expect(record.toolUses).toBe(1);

    callbacks.onToolActivity?.({
      type: "end",
      toolCallId: "bash-1",
      toolName: "bash",
    });
    expect(record.activeTool).toBeUndefined();
    expect(record.toolUses).toBe(2);
  });
});
