/** One-line subagent activity derived without a model call. */

import type { AgentRecord } from "./types.ts";
import { providerErrorLabel } from "./termination.ts";
import { streamingText } from "./content.ts";

const MAX_RECAP_CHARS = 72;
const MAX_DETAIL_CHARS = 48;

/**
 * In-flight work. Absent once a record settles: a settled agent's state is its
 * `status`, and duplicating it here would let the two disagree.
 */
export type SubagentActivity =
  | { kind: "executing"; toolName: string; detail?: string }
  | { kind: "writing"; preview: string }
  | { kind: "thinking" };

/** Collapse to a single line and clip, so one recap can never wrap a row. */
function oneLine(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Argument keys worth showing, most specific first. A tool call reads far
 * better as `read types.ts` than as `read {"path":"…","limit":40}`.
 */
const DETAIL_KEYS = [
  "path",
  "file_path",
  "command",
  "pattern",
  "query",
  "url",
  "description",
] as const;

/** The one argument that best identifies a tool call, when there is one. */
export function toolDetail(args: unknown): string | undefined {
  if (typeof args === "string")
    return oneLine(args, MAX_DETAIL_CHARS) || undefined;
  if (typeof args !== "object" || args === null) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of DETAIL_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return oneLine(value, MAX_DETAIL_CHARS);
    }
  }
  // No known key: fall back to the first short string, which is usually the
  // subject of the call. Long strings are file contents, not identifiers.
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim() && value.length <= 200) {
      return oneLine(value, MAX_DETAIL_CHARS);
    }
  }
  return undefined;
}

/** What the agent is doing, or undefined once it has settled. */
export function activityOf(record: AgentRecord): SubagentActivity | undefined {
  if (record.status !== "running" && record.status !== "queued")
    return undefined;
  if (record.activeTool) {
    return {
      kind: "executing",
      toolName: record.activeTool.name,
      detail: record.activeTool.detail,
    };
  }
  const preview = oneLine(streamingText(record.session), MAX_RECAP_CHARS);
  if (preview) return { kind: "writing", preview };
  return { kind: "thinking" };
}

function settledRecap(record: AgentRecord): string {
  switch (record.status) {
    case "error":
      return providerErrorLabel(record.errorMessage ?? record.error);
    case "aborted":
      if (record.userAborted) return "stopped by you";
      return record.hitTurnLimit ? "turn budget exhausted" : "cancelled";
    case "stopped":
      return "stopped by you";
    default: {
      const answer = record.result?.trim();
      return answer ? oneLine(answer, MAX_RECAP_CHARS) : "no final response";
    }
  }
}

/**
 * The dim suffix on a widget row: what this agent is doing, or how it ended.
 * Always non-empty, so a row never renders a dangling separator.
 */
export function recapLine(record: AgentRecord): string {
  if (record.status === "queued") return "queued";
  const activity = activityOf(record);
  if (!activity) return settledRecap(record);
  switch (activity.kind) {
    case "executing":
      return activity.detail
        ? oneLine(`${activity.toolName} ${activity.detail}`, MAX_RECAP_CHARS)
        : activity.toolName;
    case "writing":
      return activity.preview;
    case "thinking":
      return "thinking";
  }
}
