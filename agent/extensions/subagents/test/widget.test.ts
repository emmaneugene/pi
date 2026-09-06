import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord, SubagentStatus } from "../types.ts";
import {
  acknowledgeSettledFailure,
  formatDuration,
  MAX_WIDGET_ROWS,
  selectWidgetRecords,
  SubagentActivityWidget,
  type WidgetPalette,
  widgetLines,
} from "../widget.ts";

const NOW = 1_000_000;

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "abc123",
    type: "explore",
    description: "find call sites",
    invocation: {
      type: "explore",
      description: "find call sites",
      model: { value: "anthropic/claude-sonnet-5", source: "agent definition" },
      thinking: { value: "high", source: "agent definition" },
    },
    status: "running",
    turns: 1,
    toolUses: 0,
    startedAt: NOW - 5_000,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    settled: Promise.resolve(undefined),
    settle() {},
    ...overrides,
  };
}

/** Identity palette: assertions read the text, not the escape codes. */
const plain: WidgetPalette = {
  accent: (text) => text,
  dim: (text) => text,
  error: (text) => text,
};

const settledAt = (status: SubagentStatus, completedAt: number): AgentRecord =>
  record({ status, completedAt });

describe("formatDuration", () => {
  it("switches unit at each boundary", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59_400)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m00s");
    expect(formatDuration(72_000)).toBe("1m12s");
    expect(formatDuration(3_600_000)).toBe("1h00m");
    expect(formatDuration(3_900_000)).toBe("1h05m");
  });

  it("never renders a negative duration", () => {
    expect(formatDuration(-5_000)).toBe("0s");
  });
});

describe("selectWidgetRecords", () => {
  it("shows live work and hides an agent that finished long ago", () => {
    const running = record({ id: "live" });
    const old = settledAt("completed", NOW - 60_000);
    const fresh = settledAt("completed", NOW - 1_000);

    const { shown } = selectWidgetRecords([running, old, fresh], NOW);

    expect(shown.map((r) => r.id)).toEqual(["live", "abc123"]);
    expect(shown).not.toContain(old);
  });

  it("puts unacknowledged failures first, ahead of live work", () => {
    const running = record({ id: "live" });
    const failed = record({ id: "failed", status: "error", completedAt: NOW });

    const { shown } = selectWidgetRecords([running, failed], NOW);

    expect(shown.map((r) => r.id)).toEqual(["failed", "live"]);
  });

  it("hides unsuccessful runs after 10 seconds", () => {
    for (const status of ["error", "aborted", "stopped"] as const) {
      const failed = record({ status, completedAt: NOW - 9_999 });
      expect(selectWidgetRecords([failed], NOW).shown).toEqual([failed]);

      failed.completedAt = NOW - 10_000;
      expect(selectWidgetRecords([failed], NOW).shown).toEqual([]);
    }
  });

  it("hides a failure immediately after it is acknowledged", () => {
    const failed = record({ status: "error", completedAt: NOW });

    acknowledgeSettledFailure(failed);

    expect(selectWidgetRecords([failed], NOW).shown).toHaveLength(0);
  });

  it("does not pre-acknowledge a failure that occurs after viewing", () => {
    const viewedWhileRunning = record({ id: "later-failure" });

    acknowledgeSettledFailure(viewedWhileRunning);
    viewedWhileRunning.status = "error";
    viewedWhileRunning.completedAt = NOW;

    expect(viewedWhileRunning.widgetAcknowledged).toBeUndefined();
    expect(selectWidgetRecords([viewedWhileRunning], NOW).shown).toEqual([
      viewedWhileRunning,
    ]);
  });

  it("orders live work oldest first so existing rows keep their place", () => {
    const older = record({ id: "older", startedAt: NOW - 9_000 });
    const newer = record({ id: "newer", startedAt: NOW - 2_000 });
    const queued = record({
      id: "queued",
      status: "queued",
      startedAt: NOW - 5_000,
    });

    const { shown } = selectWidgetRecords([newer, queued, older], NOW);

    expect(shown.map((r) => r.id)).toEqual(["older", "queued", "newer"]);
  });

  it("caps the rows and counts the remainder", () => {
    const many = Array.from({ length: MAX_WIDGET_ROWS + 3 }, (_, i) =>
      record({ id: `a${i}`, startedAt: NOW - (100 - i) }),
    );

    const { shown, hidden } = selectWidgetRecords(many, NOW);

    expect(shown).toHaveLength(MAX_WIDGET_ROWS);
    expect(hidden).toBe(3);
  });

  it("reports nothing to show when every agent has settled and faded", () => {
    const done = settledAt("completed", NOW - 60_000);
    const acknowledged = record({ status: "error", widgetAcknowledged: true });

    expect(selectWidgetRecords([done, acknowledged], NOW)).toEqual({
      shown: [],
      hidden: 0,
    });
  });
});

describe("widgetLines", () => {
  const render = (records: AgentRecord[], width = 60) =>
    widgetLines(selectWidgetRecords(records, NOW), plain, {
      width,
      frame: 0,
      now: NOW,
    });

  it("renders nothing when there is nothing in flight", () => {
    expect(render([])).toEqual([]);
  });

  it("puts the description, the recap and the elapsed time on one row", () => {
    const [line, ...rest] = render([
      record({ activeTool: { name: "read", detail: "src/foo.ts" } }),
    ]);

    expect(rest).toEqual([]);
    expect(line).toContain("find call sites");
    expect(line).toContain("read src/foo.ts");
    expect(line).toContain("5s");
  });

  it("adds an overflow line only when rows were dropped", () => {
    const many = Array.from({ length: MAX_WIDGET_ROWS + 2 }, (_, i) =>
      record({ id: `a${i}`, startedAt: NOW - (100 - i) }),
    );

    expect(render(many)).toHaveLength(MAX_WIDGET_ROWS + 1);
    expect(render(many).at(-1)).toBe("… 2 more");
    expect(render([record()]).some((l) => l.includes("more"))).toBe(false);
  });

  it("appends the open hint when one is supplied", () => {
    const lines = widgetLines(selectWidgetRecords([record()], NOW), plain, {
      width: 60,
      frame: 0,
      now: NOW,
      openHint: "ctrl+shift+a subagents",
    });

    expect(lines.at(-1)).toBe("ctrl+shift+a subagents");
  });

  it("never exceeds the given width, even with a long description", () => {
    const wide = record({ description: "x".repeat(300) });

    for (const width of [24, 40, 80, 120]) {
      for (const line of render([wide], width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("drops the recap rather than the elapsed time when space runs out", () => {
    const [line] = render(
      [record({ activeTool: { name: "read", detail: "src/foo.ts" } })],
      26,
    );

    expect(line).toContain("5s");
    expect(line).not.toContain("read");
  });
});

describe("SubagentActivityWidget lifecycle", () => {
  const theme = {
    fg: (_color: string, text: string) => text,
  } as unknown as Theme;

  function mount(getRecords: () => AgentRecord[]) {
    let renders = 0;
    const tui = {
      requestRender: () => {
        renders += 1;
      },
    } as unknown as TUI;
    const idle = vi.fn();
    const widget = new SubagentActivityWidget(
      tui,
      theme,
      (now) => selectWidgetRecords(getRecords(), now),
      idle,
    );
    return { widget, idle, renders: () => renders };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("re-renders while work is in flight", () => {
    const { widget, idle, renders } = mount(() => [
      record({ startedAt: Date.now() }),
    ]);

    vi.advanceTimersByTime(1_000);

    expect(renders()).toBeGreaterThan(0);
    expect(idle).not.toHaveBeenCalled();
    widget.dispose();
  });

  it("asks to be removed once, then stops its timer", () => {
    // A widget cannot unmount itself, so the timer is what notices the last row
    // expiring on the clock rather than on an event.
    const { widget, idle, renders } = mount(() => []);

    vi.advanceTimersByTime(1_000);
    const after = renders();
    vi.advanceTimersByTime(5_000);

    expect(idle).toHaveBeenCalledTimes(1);
    expect(renders()).toBe(after);
    widget.dispose();
  });

  it("removes an unsuccessful run after 10 seconds", () => {
    const completedAt = Date.now();
    const { widget, idle } = mount(() => [
      record({ status: "error", completedAt }),
    ]);

    vi.advanceTimersByTime(9_999);
    expect(idle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(idle).toHaveBeenCalledOnce();
    widget.dispose();
  });

  it("stops ticking when disposed", () => {
    const { widget, renders } = mount(() => [
      record({ startedAt: Date.now() }),
    ]);

    vi.advanceTimersByTime(500);
    const before = renders();
    widget.dispose();
    vi.advanceTimersByTime(5_000);

    expect(renders()).toBe(before);
  });

  it("renders live rows through the real theme accessor", () => {
    const { widget } = mount(() => [
      record({ startedAt: Date.now() - 3_000, activeTool: { name: "grep" } }),
    ]);

    const lines = widget.render(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("find call sites");
    expect(lines[0]).toContain("grep");
    widget.dispose();
  });
});
