import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, it } from "vitest";

type Extension = (typeof import("../index.ts"))["default"];
let autocompact: Extension;

// Point the extension at a fixed config before it computes STATE_FILE.
beforeAll(async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "autocompact-"));
  writeFileSync(
    join(agentDir, "autocompact.json"),
    JSON.stringify({ enabled: true, thresholdPercent: 50 }),
  );
  process.env.PI_CODING_AGENT_DIR = agentDir;
  autocompact = (await import("../index.ts")).default;
});

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const notices: string[] = [];
  const statuses: Array<string | undefined> = [];
  let tokens: number | null = 0;
  let compaction:
    { onComplete: () => void; onError: (error: Error) => void } | undefined;

  const ctx = {
    hasUI: true,
    model: { provider: "test", id: "model", contextWindow: 1000 },
    ui: {
      setStatus: (_id: string, text: string | undefined) => statuses.push(text),
      notify: (message: string) => notices.push(message),
    },
    getContextUsage: () => ({
      tokens,
      contextWindow: 1000,
      percent: tokens === null ? null : tokens / 10,
    }),
    compact: (callbacks: NonNullable<typeof compaction>) => {
      compaction = callbacks;
    },
  };

  autocompact({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  } as never);
  handlers.get("session_start")!({}, ctx);

  return {
    notices,
    statuses,
    settle(usedTokens: number | null) {
      tokens = usedTokens;
      handlers.get("agent_settled")!({}, ctx);
    },
    compaction: () => compaction,
  };
}

describe("autocompact", () => {
  it("compacts once over threshold and warns when the next response is still over", () => {
    const h = harness();
    h.settle(600);
    assert.ok(h.compaction(), "compaction requested");
    h.compaction()!.onComplete();
    assert.match(h.notices.at(-1)!, /Compaction complete/);

    // Usage is unknown until an assistant responds; no decision yet.
    h.settle(null);
    assert.match(h.notices.at(-1)!, /Compaction complete/);

    h.settle(700);
    assert.match(h.notices.at(-1)!, /terminate this session/);
    assert.equal(h.statuses.at(-1), "autocompact: terminate session");
  });

  it("returns to ready when the post-compaction response is under threshold", () => {
    const h = harness();
    h.settle(600);
    const first = h.compaction()!;
    first.onComplete();
    h.settle(100);

    h.settle(600);
    assert.notEqual(h.compaction(), first, "compacts again from ready");
  });

  it("returns to ready after a failed compaction", () => {
    const h = harness();
    h.settle(600);
    const first = h.compaction()!;
    first.onError(new Error("boom"));
    assert.match(h.notices.at(-1)!, /Compaction failed: boom/);

    h.settle(600);
    assert.notEqual(h.compaction(), first, "compacts again from ready");
  });
});
