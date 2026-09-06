import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { notify, setStatus, type UiContext } from "../ui.ts";

const STALE_CTX_ERROR = new Error(
  "This extension ctx is stale after session replacement or reload.",
);

function staleCtx(): UiContext {
  return {
    get hasUI(): boolean {
      throw STALE_CTX_ERROR;
    },
    ui: {
      setStatus() {
        throw new Error("setStatus should not run on a stale ctx");
      },
      notify() {
        throw new Error("notify should not run on a stale ctx");
      },
    },
  };
}

function liveCtx(hasUI: boolean): UiContext & {
  statuses: Array<string | undefined>;
  notices: Array<{ message: string; type: string }>;
} {
  const statuses: Array<string | undefined> = [];
  const notices: Array<{ message: string; type: string }> = [];
  return {
    hasUI,
    ui: {
      setStatus(_id, text) {
        statuses.push(text);
      },
      notify(message, type) {
        notices.push({ message, type });
      },
    },
    statuses,
    notices,
  };
}

describe("notify", () => {
  it("does not throw on a stale ctx and logs warning and error", () => {
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
    };
    notify(staleCtx(), "Compaction failed: boom", "error", log);
    notify(staleCtx(), "You should terminate this session", "warning", log);
    notify(staleCtx(), "Compacting...", "info", log);
    assert.deepEqual(lines, [
      "[autocompact] Compaction failed: boom",
      "[autocompact] You should terminate this session",
    ]);
  });

  it("skips UI notify in headless mode and still logs errors", () => {
    const ctx = liveCtx(false);
    const lines: string[] = [];
    notify(ctx, "Compaction failed: boom", "error", (line) => {
      lines.push(line);
    });
    assert.deepEqual(ctx.notices, []);
    assert.deepEqual(lines, ["[autocompact] Compaction failed: boom"]);
  });

  it("notifies a live UI", () => {
    const ctx = liveCtx(true);
    notify(ctx, "Compaction complete.", "info");
    assert.deepEqual(ctx.notices, [
      { message: "Compaction complete.", type: "info" },
    ]);
  });
});

describe("setStatus", () => {
  it("does not throw on a stale ctx", () => {
    setStatus(staleCtx(), "autocompact: terminate session");
  });

  it("updates status when UI is live", () => {
    const ctx = liveCtx(true);
    setStatus(ctx, "autocompact off");
    assert.deepEqual(ctx.statuses, ["autocompact off"]);
  });
});
