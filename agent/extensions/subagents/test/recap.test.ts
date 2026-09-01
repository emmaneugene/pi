import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { activityOf, recapLine, toolDetail } from "../recap.ts";
import type { AgentRecord, SubagentStatus } from "../types.ts";

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
    startedAt: 1_000,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    ...overrides,
  };
}

/** A session whose only observable is the in-progress assistant text. */
function streamingSession(text: string): AgentSession {
  return {
    agent: {
      state: { streamingMessage: { content: [{ type: "text", text }] } },
    },
  } as unknown as AgentSession;
}

describe("toolDetail", () => {
  it("prefers a path over other arguments", () => {
    expect(toolDetail({ limit: 40, path: "src/foo.ts", offset: 2 })).toBe(
      "src/foo.ts",
    );
  });

  it("falls back through the known keys in order", () => {
    expect(toolDetail({ command: "npm test" })).toBe("npm test");
    expect(toolDetail({ pattern: "AgentRecord" })).toBe("AgentRecord");
  });

  it("uses a short unknown string when no known key is present", () => {
    expect(toolDetail({ subagent_type: "review" })).toBe("review");
  });

  it("ignores a long string, which is content rather than an identifier", () => {
    expect(toolDetail({ content: "x".repeat(500) })).toBeUndefined();
  });

  it("collapses whitespace and clips a long identifier", () => {
    const detail = toolDetail({
      command: `git   log\n--oneline ${"a".repeat(80)}`,
    });
    expect(detail).toMatch(/^git log --oneline a+…$/);
    expect(detail!.length).toBeLessThanOrEqual(48);
  });

  it("accepts raw string arguments and rejects non-objects", () => {
    expect(toolDetail("ls -la")).toBe("ls -la");
    expect(toolDetail(undefined)).toBeUndefined();
    expect(toolDetail(42)).toBeUndefined();
  });
});

describe("activityOf", () => {
  it("is absent once the agent settles, so status stays the single source", () => {
    const settled: SubagentStatus[] = [
      "completed",
      "steered",
      "error",
      "aborted",
      "stopped",
    ];
    for (const status of settled) {
      expect(activityOf(record({ status }))).toBeUndefined();
    }
  });

  it("reports the tool in flight ahead of any streamed text", () => {
    const activity = activityOf(
      record({
        activeTool: { name: "read", detail: "src/foo.ts" },
        session: streamingSession("about to read the file"),
      }),
    );
    expect(activity).toEqual({
      kind: "executing",
      toolName: "read",
      detail: "src/foo.ts",
    });
  });

  it("reports streamed text when no tool is running", () => {
    expect(
      activityOf(
        record({ session: streamingSession("Looking at\nthe router") }),
      ),
    ).toEqual({ kind: "writing", preview: "Looking at the router" });
  });

  it("falls back to thinking when there is no tool and no text yet", () => {
    expect(activityOf(record())).toEqual({ kind: "thinking" });
    expect(activityOf(record({ session: streamingSession("   ") }))).toEqual({
      kind: "thinking",
    });
  });
});

describe("recapLine", () => {
  it("names a queued agent without inspecting its session", () => {
    expect(recapLine(record({ status: "queued" }))).toBe("queued");
  });

  it("joins the tool and its detail, and copes with a detail-free call", () => {
    expect(
      recapLine(record({ activeTool: { name: "read", detail: "a.ts" } })),
    ).toBe("read a.ts");
    expect(recapLine(record({ activeTool: { name: "ls" } }))).toBe("ls");
  });

  it("classifies a failure without echoing provider text", () => {
    const line = recapLine(
      record({
        status: "error",
        errorMessage: "429 rate limit exceeded for key sk-abc123",
      }),
    );
    expect(line).toBe("transient provider failure");
    expect(line).not.toContain("sk-abc123");
  });

  it("distinguishes the three ways a run can stop", () => {
    expect(recapLine(record({ status: "stopped", userAborted: true }))).toBe(
      "stopped by you",
    );
    expect(recapLine(record({ status: "aborted", hitTurnLimit: true }))).toBe(
      "turn budget exhausted",
    );
    expect(recapLine(record({ status: "aborted" }))).toBe("cancelled");
  });

  it("previews the answer, or says plainly that there was none", () => {
    expect(
      recapLine(
        record({
          status: "completed",
          result: "Found 3 call sites\nin router.ts",
        }),
      ),
    ).toBe("Found 3 call sites in router.ts");
    expect(recapLine(record({ status: "completed", result: "  " }))).toBe(
      "no final response",
    );
  });

  it("never returns an empty string, so a row cannot show a dangling separator", () => {
    const statuses: SubagentStatus[] = [
      "queued",
      "running",
      "completed",
      "steered",
      "error",
      "aborted",
      "stopped",
    ];
    for (const status of statuses) {
      expect(recapLine(record({ status })).length).toBeGreaterThan(0);
    }
  });
});
