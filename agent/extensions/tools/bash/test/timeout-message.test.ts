import { describe, expect, it } from "vitest";
import { explainTimeout, rewriteTimeoutMessage } from "../timeout-message.ts";

// The exact shape the built-in bash tool throws, captured from it directly.
const WITH_OUTPUT =
  "LINE_ONE\nLINE_TWO\n\n\nCommand timed out after 300 seconds";
const WITHOUT_OUTPUT = "Command timed out after 300 seconds";

describe("rewriteTimeoutMessage", () => {
  it("leaves messages that are not the built-in notice untouched", () => {
    for (const other of [
      "aborted",
      "bash: nope: command not found",
      // A command whose own output mentions a timeout, but which did not time out.
      "test failed: Command timed out after 30 seconds\nFAILED 1 test",
    ]) {
      expect(rewriteTimeoutMessage(other, false)).toBe(other);
    }
  });

  it("preserves the partial output verbatim", () => {
    const rewritten = rewriteTimeoutMessage(WITH_OUTPUT, false);
    expect(rewritten.startsWith("LINE_ONE\nLINE_TWO")).toBe(true);
    expect(rewritten).toContain("output above is partial");
  });

  it("says so when there was no output", () => {
    const rewritten = rewriteTimeoutMessage(WITHOUT_OUTPUT, false);
    expect(rewritten).toContain("produced no output");
    expect(rewritten).not.toContain("output above is partial");
  });

  it("keeps the elapsed seconds", () => {
    expect(
      rewriteTimeoutMessage("Command timed out after 45 seconds", false),
    ).toContain("after 45s");
  });

  it("leads with narrowing the search, the most common cause", () => {
    const options = rewriteTimeoutMessage(WITHOUT_OUTPUT, false)
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(options).toHaveLength(3);
    expect(options[0]).toContain("Scope it");
  });

  it("offers an explicit timeout only when the caller did not already set one", () => {
    expect(rewriteTimeoutMessage(WITHOUT_OUTPUT, false)).toContain(
      '{"timeout": 1800}',
    );
    const explicit = rewriteTimeoutMessage(WITHOUT_OUTPUT, true);
    expect(explicit).not.toContain('{"timeout": 1800}');
    expect(explicit).toContain("raising the timeout again is a guess");
  });

  it("always offers backgrounding", () => {
    for (const explicit of [true, false]) {
      expect(rewriteTimeoutMessage(WITHOUT_OUTPUT, explicit)).toContain(
        "nohup",
      );
    }
  });
});

describe("explainTimeout", () => {
  it("rewrites a timeout Error", () => {
    const out = explainTimeout(new Error(WITHOUT_OUTPUT), false);
    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toContain("Pick the case that fits");
  });

  it("passes other errors through by identity", () => {
    const aborted = new Error("aborted");
    expect(explainTimeout(aborted, false)).toBe(aborted);
    const notAnError = { weird: true };
    expect(explainTimeout(notAnError, false)).toBe(notAnError);
  });
});
