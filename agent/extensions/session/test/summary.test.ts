import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  cheapSummaryText,
  composeSessionName,
  currentModelId,
  firstUserMessageText,
  isUserNamedLocked,
  lastMessageText,
  readSummaryState,
  shouldGenerateSummary,
  shouldLockSessionName,
} from "../summary.ts";

type Entry = Parameters<typeof readSummaryState>[0][number];

const message = (role: string, ...content: unknown[]): Entry =>
  ({ type: "message", id: role, message: { role, content } }) as Entry;
const text = (value: string) => ({ type: "text", text: value });
const toolCall = (name: string) => ({ type: "toolCall", name });
const summaryEntry = (value: string, composedName?: string): Entry =>
  ({
    type: "custom",
    id: "s",
    customType: "session-summary",
    data: composedName ? { text: value, composedName } : { text: value },
  }) as Entry;
const userNamed = (locked: boolean): Entry =>
  ({
    type: "custom",
    id: "u",
    customType: "user-named",
    data: { locked },
  }) as Entry;
const compaction = (): Entry => ({ type: "compaction", id: "c" }) as Entry;

describe("readSummaryState", () => {
  it("is stale when no summary was ever written", () => {
    expect(readSummaryState([message("user", text("hi"))])).toEqual({
      text: undefined,
      composedName: undefined,
      stale: true,
    });
  });

  it("reuses a summary with no compaction after it", () => {
    const branch = [compaction(), summaryEntry("built the thing")];
    expect(readSummaryState(branch)).toEqual({
      text: "built the thing",
      composedName: undefined,
      stale: false,
    });
  });

  it("goes stale when a compaction lands after the summary", () => {
    const branch = [summaryEntry("built the thing"), compaction()];
    expect(readSummaryState(branch)).toEqual({
      text: "built the thing",
      composedName: undefined,
      stale: true,
    });
  });

  it("keeps the newest summary when several exist", () => {
    const branch = [summaryEntry("old"), summaryEntry("new")];
    expect(readSummaryState(branch).text).toBe("new");
  });

  it("reads composedName from the newest summary", () => {
    const branch = [
      summaryEntry("old", "[gpt] (main) old"),
      summaryEntry("new", "[gpt] (main) new"),
    ];
    expect(readSummaryState(branch)).toEqual({
      text: "new",
      composedName: "[gpt] (main) new",
      stale: false,
    });
  });
});

describe("isUserNamedLocked", () => {
  it("is unlocked when no latch exists", () => {
    expect(isUserNamedLocked([message("user", text("hi"))])).toBe(false);
  });

  it("locks when --name ran before any summary", () => {
    expect(isUserNamedLocked([userNamed(true)])).toBe(true);
  });

  it("clears the lock when /summary:update appends locked: false", () => {
    expect(isUserNamedLocked([userNamed(true), userNamed(false)])).toBe(false);
  });

  it("uses the latest latch", () => {
    expect(isUserNamedLocked([userNamed(false), userNamed(true)])).toBe(true);
  });

  it("skips a malformed latch and keeps the previous one", () => {
    const malformed = {
      type: "custom",
      id: "bad",
      customType: "user-named",
      data: { locked: "yes" },
    } as Entry;
    expect(isUserNamedLocked([userNamed(true), malformed])).toBe(true);
  });
});

describe("shouldLockSessionName", () => {
  const expected = "[gpt-5.6-luna] (main) fixing subagent overrides";

  it("locks a cleared name", () => {
    expect(shouldLockSessionName(undefined, expected)).toBe(true);
    expect(shouldLockSessionName("", expected)).toBe(true);
  });

  it("locks when the live name differs from composedName", () => {
    expect(shouldLockSessionName("research#abc12345", expected)).toBe(true);
  });

  it("locks --name before any summary", () => {
    expect(
      shouldLockSessionName(
        "my session",
        "[gpt-5.6-luna] (main) start the work",
      ),
    ).toBe(true);
  });

  it("does not lock when the live name matches the expected compose", () => {
    expect(shouldLockSessionName(expected, expected)).toBe(false);
  });

  it("locks any live name when there is no composedName to compare", () => {
    expect(shouldLockSessionName("research#abc12345", undefined)).toBe(true);
  });
});

describe("shouldGenerateSummary", () => {
  it("never generates on the cheap first-message path", () => {
    expect(
      shouldGenerateSummary({
        reason: "cheap",
        hasConfig: true,
        stale: true,
        hasText: true,
      }),
    ).toBe(false);
  });

  it("generates on force even without config", () => {
    expect(
      shouldGenerateSummary({
        reason: "force",
        hasConfig: false,
        stale: false,
        hasText: false,
      }),
    ).toBe(true);
  });

  it("regenerates on settle when compaction made the summary stale", () => {
    expect(
      shouldGenerateSummary({
        reason: "settle",
        hasConfig: true,
        stale: true,
        hasText: true,
      }),
    ).toBe(true);
  });

  it("reuses a fresh summary on settle", () => {
    expect(
      shouldGenerateSummary({
        reason: "settle",
        hasConfig: true,
        stale: false,
        hasText: true,
      }),
    ).toBe(false);
  });

  it("does not generate on fork or shutdown recompose", () => {
    expect(
      shouldGenerateSummary({
        reason: "recompose",
        hasConfig: true,
        stale: true,
        hasText: true,
      }),
    ).toBe(false);
  });
});

describe("lastMessageText", () => {
  it("takes the last spoken line from either side", () => {
    const branch = [
      message("user", text("start the work")),
      message("assistant", text("done, tests pass")),
    ];
    expect(lastMessageText(branch)).toBe("done, tests pass");
  });

  it("skips messages that carry only tool calls", () => {
    const branch = [
      message("user", text("run the tests")),
      message("assistant", toolCall("bash")),
    ];
    expect(lastMessageText(branch)).toBe("run the tests");
  });

  it("ignores tool results", () => {
    const branch = [
      message("user", text("read it")),
      message("toolResult", text("400 lines of output")),
    ];
    expect(lastMessageText(branch)).toBe("read it");
  });

  it("collapses newlines into one line", () => {
    const branch = [message("user", text("first line\n\nsecond line"))];
    expect(lastMessageText(branch)).toBe("first line second line");
  });
});

describe("cheapSummaryText", () => {
  it("uses the event body when the branch has not persisted the message yet", () => {
    expect(cheapSummaryText([text("start the work")], [])).toBe(
      "start the work",
    );
  });

  it("falls back to the first persisted user line", () => {
    expect(
      cheapSummaryText([], [message("user", text("start the work"))]),
    ).toBe("start the work");
  });
});

describe("firstUserMessageText", () => {
  it("keeps the first spoken user line after later replies", () => {
    const branch = [
      message("user", text("start the work")),
      message("assistant", text("done, tests pass")),
      message("user", text("now the next bit")),
    ];
    expect(firstUserMessageText(branch)).toBe("start the work");
  });

  it("skips a user message that carries only tool calls", () => {
    const branch = [
      message("user", toolCall("bash")),
      message("user", text("the real prompt")),
    ];
    expect(firstUserMessageText(branch)).toBe("the real prompt");
  });
});

describe("currentModelId", () => {
  const branch = [
    { type: "model_change", id: "m1", modelId: "gpt-5.6-sol" },
    { type: "model_change", id: "m2", modelId: "claude-opus-5" },
  ] as Entry[];

  it("prefers the live model", () => {
    const ctx = { model: { id: "gpt-5.6-luna" } } as ExtensionContext;
    expect(currentModelId(ctx, branch)).toBe("gpt-5.6-luna");
  });

  it("falls back to the last recorded switch", () => {
    const ctx = { model: undefined } as ExtensionContext;
    expect(currentModelId(ctx, branch)).toBe("claude-opus-5");
  });

  it("reports nothing when the session never had a model", () => {
    const ctx = { model: undefined } as ExtensionContext;
    expect(currentModelId(ctx, [])).toBeUndefined();
  });
});

describe("composeSessionName", () => {
  it("renders all three parts", () => {
    expect(
      composeSessionName({
        modelId: "gpt-5.6-luna",
        gitBranch: "bcg",
        summary: "fixing subagent overrides",
      }),
    ).toBe("[gpt-5.6-luna] (bcg) fixing subagent overrides");
  });

  it("drops the branch outside a repo", () => {
    expect(
      composeSessionName({ modelId: "gpt-5.6-luna", summary: "scratch work" }),
    ).toBe("[gpt-5.6-luna] scratch work");
  });

  it("still names a session that has no summary", () => {
    expect(
      composeSessionName({ modelId: "gpt-5.6-luna", gitBranch: "main" }),
    ).toBe("[gpt-5.6-luna] (main)");
  });

  it("returns nothing when there is nothing to say", () => {
    expect(composeSessionName({})).toBeUndefined();
  });
});
