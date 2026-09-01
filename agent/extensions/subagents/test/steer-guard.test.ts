import { describe, expect, it } from "vitest";
import { type TurnOutcome, willContinue } from "../steer-guard.ts";

const ALL_OUTCOMES: TurnOutcome[] = [
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
];

describe("willContinue", () => {
  it("is true only for a turn that ended in a tool call", () => {
    expect(willContinue("toolUse")).toBe(true);
  });

  it.each(ALL_OUTCOMES.filter((o) => o !== "toolUse"))(
    "is false for %s, which steering would restart",
    (outcome) => {
      expect(willContinue(outcome)).toBe(false);
    },
  );

  it("is false when the outcome is unknown", () => {
    expect(willContinue(undefined)).toBe(false);
  });
});
