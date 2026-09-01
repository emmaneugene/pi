import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { activityEvents, inspectActivity } from "../activity.ts";

type TranscriptMessage = AgentSession["messages"][number];

const assistant = (text: string): TranscriptMessage =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
  }) as TranscriptMessage;

const toolCall = (name: string, args: unknown): TranscriptMessage =>
  ({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name, arguments: args }],
  }) as TranscriptMessage;

const toolResult = (name: string, text: string): TranscriptMessage =>
  ({
    role: "toolResult",
    toolCallId: "call-1",
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
  }) as TranscriptMessage;

function session(
  messages: TranscriptMessage[],
  streamingText?: string,
): AgentSession {
  return {
    messages,
    agent: {
      state: {
        streamingMessage: streamingText ? assistant(streamingText) : undefined,
      },
    },
  } as AgentSession;
}

describe("activityEvents", () => {
  it("renders assistant text, tool calls, and tool results", () => {
    expect(
      activityEvents([
        assistant("Investigating"),
        toolCall("read", { path: "/tmp/a" }),
        toolResult("read", "contents"),
      ]),
    ).toEqual([
      "assistant: Investigating",
      'tool call read: {"path":"/tmp/a"}',
      "tool result read: contents",
    ]);
  });

  it("omits user prompts and non-text content", () => {
    const user = {
      role: "user",
      content: [{ type: "text", text: "private task" }],
    } as TranscriptMessage;
    expect(activityEvents([user])).toEqual([]);
  });
});

describe("inspectActivity", () => {
  it("returns only activity newer than a valid cursor", () => {
    const result = inspectActivity(
      session([assistant("one"), assistant("two")]),
      1,
      10,
    );

    expect(result).toMatchObject({
      cursor: 2,
      events: ["assistant: two"],
      truncated: false,
      cursorReset: false,
    });
  });

  it("bounds old activity and reports truncation", () => {
    const result = inspectActivity(
      session([assistant("one"), assistant("two"), assistant("three")]),
      0,
      2,
    );

    expect(result.events).toEqual(["assistant: two", "assistant: three"]);
    expect(result.truncated).toBe(true);
    expect(result.cursor).toBe(3);
  });

  it("returns in-progress text without advancing the settled cursor", () => {
    const result = inspectActivity(
      session([assistant("settled")], "still working"),
      1,
      10,
    );

    expect(result.events).toEqual([]);
    expect(result.current).toBe("still working");
    expect(result.cursor).toBe(1);
  });

  it("resets a stale cursor to a bounded recent snapshot", () => {
    const result = inspectActivity(session([assistant("one")]), 99, 10);

    expect(result.cursorReset).toBe(true);
    expect(result.events).toEqual(["assistant: one"]);
  });
});
