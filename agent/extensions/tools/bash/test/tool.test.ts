/**
 * Drives the registered tool against the real built-in bash tool. This is the
 * canary for upstream rewording its timeout notice: if the built-in stops
 * emitting `Command timed out after N seconds`, the rewrite silently stops
 * applying, and this fails rather than degrading quietly.
 */

import { describe, expect, it } from "vitest";
import register from "../index.ts";

type Tool = {
  name: string;
  renderCall?: unknown;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
};

function load(): Tool {
  const registered: Tool[] = [];
  register({ registerTool: (t: Tool) => registered.push(t) } as never);
  expect(registered).toHaveLength(1);
  return registered[0];
}

const ctx = {
  sessionManager: {
    getSessionId: () => "session-abc",
    getSessionFile: () => "/tmp/session-abc.jsonl",
  },
  model: { provider: "anthropic", id: "claude-opus-5" },
  thinkingLevel: "medium",
};

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");

describe("registration", () => {
  it("overrides bash and keeps the built-in renderer", () => {
    const tool = load();
    expect(tool.name).toBe("bash");
    // Spreading the AgentTool instead of the definition would drop this.
    expect(typeof tool.renderCall).toBe("function");
  });
});

describe("timeout rewriting against the real bash tool", () => {
  it("replaces the notice and keeps the partial output", async () => {
    const tool = load();
    const error = await tool
      .execute(
        "c",
        { command: "echo LINE_ONE; echo LINE_TWO; sleep 30", timeout: 2 },
        undefined,
        undefined,
        ctx,
      )
      .then(() => undefined)
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message.startsWith("LINE_ONE\nLINE_TWO")).toBe(true);
    expect(message).toContain("timed out after 2s and was killed");
    expect(message).toContain("Pick the case that fits");
    expect(message).toContain("nohup");
    // An explicit timeout was passed, so re-raising it is not offered.
    expect(message).not.toContain('{"timeout": 1800}');
  });

  it("leaves an ordinary command failure untouched", async () => {
    // A non-zero exit also throws, with the output as the message, so the
    // rewrite has to discriminate on the notice rather than on failure alone.
    const tool = load();
    const error = await tool
      .execute("c", { command: "echo hi; exit 3" }, undefined, undefined, ctx)
      .then(() => undefined)
      .catch((e: Error) => e);

    expect((error as Error).message).toContain("hi");
    expect((error as Error).message).not.toContain("Pick the case that fits");
  });
});

describe("session environment", () => {
  it("forwards ctx so PI_SESSION_ID reaches the command", async () => {
    const tool = load();
    const result = await tool.execute(
      "c",
      {
        command: "echo id=$PI_SESSION_ID model=$PI_MODEL provider=$PI_PROVIDER",
      },
      undefined,
      undefined,
      ctx,
    );
    expect(textOf(result)).toContain(
      "id=session-abc model=claude-opus-5 provider=anthropic",
    );
  });

  it("still runs when there is no ctx", async () => {
    const tool = load();
    const result = await tool.execute(
      "c",
      { command: "echo ok" },
      undefined,
      undefined,
      undefined,
    );
    expect(textOf(result)).toContain("ok");
  });
});
