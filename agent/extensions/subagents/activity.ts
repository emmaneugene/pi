import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { streamingText, textContent } from "./content.ts";

const DEFAULT_MAX_EVENTS = 12;
const MAX_EVENTS = 30;
const MAX_EVENT_CHARS = 2_000;
const MAX_SNAPSHOT_CHARS = 12_000;
const MAX_CURRENT_CHARS = 3_000;

type TranscriptMessage = AgentSession["messages"][number];

export interface ActivitySnapshot {
  cursor: number;
  events: string[];
  current?: string;
  truncated: boolean;
  cursorReset: boolean;
}

function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

function toolArguments(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable arguments]";
  }
}

/** Convert settled transcript messages into stable, cursor-addressable events. */
export function activityEvents(
  messages: readonly TranscriptMessage[],
): string[] {
  const events: string[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const text = textContent(message.content);
      if (text.trim()) {
        events.push(`assistant: ${truncate(text, MAX_EVENT_CHARS)}`);
      }
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        const args = truncate(toolArguments(part.arguments), MAX_EVENT_CHARS);
        events.push(`tool call ${part.name}: ${args || "{}"}`);
      }
    } else if (message.role === "toolResult") {
      const text = truncate(textContent(message.content), MAX_EVENT_CHARS);
      const outcome = message.isError ? "error" : "result";
      events.push(
        `tool ${outcome} ${message.toolName}: ${text || "(no text output)"}`,
      );
    }
  }
  return events;
}

/**
 * Return a bounded activity snapshot. The cursor counts settled events; the
 * in-progress assistant message is returned separately and does not advance it.
 */
export function inspectActivity(
  session: AgentSession | undefined,
  sinceCursor?: number,
  requestedMaxEvents?: number,
): ActivitySnapshot {
  if (!session) {
    return {
      cursor: 0,
      events: [],
      truncated: false,
      cursorReset: false,
    };
  }

  const events = activityEvents(session.messages);
  const cursor = events.length;
  const maxEvents = Math.min(
    MAX_EVENTS,
    Math.max(1, Math.floor(requestedMaxEvents ?? DEFAULT_MAX_EVENTS)),
  );
  const validCursor =
    sinceCursor == null ||
    (Number.isInteger(sinceCursor) &&
      sinceCursor >= 0 &&
      sinceCursor <= cursor);
  const base = validCursor && sinceCursor != null ? sinceCursor : 0;
  const start = Math.max(base, cursor - maxEvents);
  const current =
    truncate(streamingText(session), MAX_CURRENT_CHARS) || undefined;

  const recent = events.slice(start);
  const bounded: string[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const event = recent[i];
    const nextChars = chars + event.length;
    if (bounded.length > 0 && nextChars > MAX_SNAPSHOT_CHARS) break;
    bounded.unshift(event);
    chars = nextChars;
  }

  return {
    cursor,
    events: bounded,
    current,
    truncated: start > base || bounded.length < recent.length,
    cursorReset: !validCursor,
  };
}
