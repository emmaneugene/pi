import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSubagentTranscripts } from "../transcript.ts";
import { SUBAGENT_INVOCATION_ENTRY } from "../types.ts";

function jsonl(entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

const invocation = {
  type: "explore",
  description: "find call sites",
  model: { value: "test/model", source: "agent definition" },
  thinking: { value: "low", source: "agent definition" },
};

describe("listSubagentTranscripts", () => {
  it("summarizes valid transcripts and skips malformed or foreign files", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "subagents-"));
    const dir = join(sessionDir, "subagents", "parent-1");
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      join(dir, "a.jsonl"),
      jsonl([
        {
          type: "session",
          id: "child-a",
          timestamp: "2026-01-01T00:00:00Z",
          parentSession: "p.jsonl",
        },
        {
          type: "custom",
          customType: SUBAGENT_INVOCATION_ENTRY,
          data: invocation,
        },
        {
          type: "message",
          message: { role: "user", content: "first line\nsecond" },
        },
        { type: "message", message: { role: "assistant", content: "ok" } },
        { type: "message", message: { role: "assistant", content: "done" } },
      ]),
    );
    writeFileSync(
      join(dir, "not-a-session.jsonl"),
      jsonl([{ type: "message", message: { role: "user", content: "x" } }]),
    );
    writeFileSync(join(dir, "broken.jsonl"), "{not json\n");

    expect(listSubagentTranscripts(sessionDir, "parent-1")).toEqual([
      {
        id: "child-a",
        file: join(dir, "a.jsonl"),
        parentSession: "p.jsonl",
        task: "first line",
        invocation,
        turns: 2,
        mtime: Date.parse("2026-01-01T00:00:00Z"),
      },
    ]);
  });

  it("returns nothing without a parent session or directory", () => {
    expect(listSubagentTranscripts("/nonexistent", "p")).toEqual([]);
    expect(listSubagentTranscripts("/nonexistent", undefined)).toEqual([]);
  });
});
