/**
 * transcript.ts — Read a persisted pi session JSONL into display lines, and
 * discover the current session's subagent transcripts on disk.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { transcriptContent } from "./content.ts";
import {
  type InvocationSettingSource,
  SUBAGENT_INVOCATION_ENTRY,
  type SubagentInvocation,
} from "./types.ts";

export interface DiskTranscript {
  /** Child session id (from the file header). */
  id: string;
  /** Absolute path to the .jsonl file. */
  file: string;
  /** Parent session id this child was spawned from. */
  parentSession?: string;
  /** First user prompt (the task), trimmed to one line. */
  task: string;
  /** Exact persisted invocation, or best-effort metadata for older files. */
  invocation?: SubagentInvocation;
  /** Completed model turns, inferred from persisted assistant messages. */
  turns: number;
  /** mtime epoch ms, for sorting. */
  mtime: number;
}

const INVOCATION_SOURCES = new Set<InvocationSettingSource>([
  "tool override",
  "agent definition",
  "inherited/default",
  "unknown",
]);

function parseInvocation(value: unknown): SubagentInvocation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, any>;
  if (
    typeof v.type !== "string" ||
    typeof v.description !== "string" ||
    typeof v.model?.value !== "string" ||
    !INVOCATION_SOURCES.has(v.model?.source) ||
    typeof v.thinking?.value !== "string" ||
    !INVOCATION_SOURCES.has(v.thinking?.source)
  ) {
    return undefined;
  }
  return {
    type: v.type,
    description: v.description,
    definitionPath:
      typeof v.definitionPath === "string" ? v.definitionPath : undefined,
    model: { value: v.model.value, source: v.model.source },
    thinking: { value: v.thinking.value, source: v.thinking.source },
  };
}

/** Display metadata from transcript lines, inferring what older transcripts lack. */
function transcriptSummary(lines: readonly string[]): {
  task: string;
  invocation?: SubagentInvocation;
  turns: number;
} {
  let task = "";
  let turns = 0;
  let exact: SubagentInvocation | undefined;
  let sessionName = "";
  let model = "";
  let thinking = "";
  try {
    for (const line of lines) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === "message" && e.message?.role === "assistant") turns++;
      if (!task && e.type === "message" && e.message?.role === "user") {
        task = transcriptContent(e.message.content)
          .trim()
          .split("\n")[0]
          .slice(0, 80);
      } else if (
        e.type === "custom" &&
        e.customType === SUBAGENT_INVOCATION_ENTRY
      ) {
        exact = parseInvocation(e.data) ?? exact;
      } else if (e.type === "session_info" && typeof e.name === "string") {
        sessionName = e.name;
      } else if (
        e.type === "model_change" &&
        typeof e.provider === "string" &&
        typeof e.modelId === "string"
      ) {
        model = `${e.provider}/${e.modelId}`;
      } else if (
        e.type === "thinking_level_change" &&
        typeof e.thinkingLevel === "string"
      ) {
        thinking = e.thinkingLevel;
      }
    }
  } catch {
    return { task, turns };
  }
  if (exact) return { task, invocation: exact, turns };

  const type = sessionName.includes("#")
    ? sessionName.slice(0, sessionName.lastIndexOf("#"))
    : "";
  if (!type && !model && !thinking) return { task, turns };
  return {
    task,
    turns,
    invocation: {
      type: type || "unknown",
      description: task || "subagent",
      model: { value: model || "unknown", source: "unknown" },
      thinking: { value: thinking || "unknown", source: "unknown" },
    },
  };
}

/**
 * List subagent transcripts owned by `parentSessionId`. Ownership is
 * structural: children live in `<sessionDir>/subagents/<parentSessionId>/`,
 * so no header filtering is needed.
 */
export function listSubagentTranscripts(
  sessionDir: string,
  parentSessionId: string | undefined,
): DiskTranscript[] {
  if (!parentSessionId) return [];
  const dir = join(sessionDir, "subagents", parentSessionId);
  if (!existsSync(dir)) return [];
  const out: DiskTranscript[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  for (const f of files) {
    const file = join(dir, f);
    let lines: string[];
    let header: Record<string, unknown> | undefined;
    let mtime = 0;
    try {
      lines = readFileSync(file, "utf-8").split("\n");
      header = JSON.parse(lines[0]!);
      mtime = Date.parse(String(header?.timestamp ?? "")) || 0;
    } catch {
      continue;
    }
    if (!header || header.type !== "session") continue;
    const summary = transcriptSummary(lines);
    out.push({
      id: String(header.id ?? basename(f, ".jsonl")),
      file,
      parentSession: header.parentSession as string | undefined,
      task: summary.task,
      invocation: summary.invocation,
      turns: summary.turns,
      mtime,
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Render a transcript file as readable plain text (role headers + bodies),
 * suitable for opening in $EDITOR. No wrapping — the editor handles display.
 */
export function renderTranscriptText(file: string): string {
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (err) {
    return `(could not read transcript: ${err instanceof Error ? err.message : String(err)})`;
  }
  const blocks: string[] = [];
  for (const l of raw.split("\n")) {
    if (!l.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if (e.type === "message") {
      const role = e.message?.role ?? "?";
      const body = transcriptContent(e.message?.content).trim();
      if (!body) continue;
      blocks.push(`── ${String(role).toUpperCase()} ──\n${body}`);
    }
  }
  return blocks.length ? blocks.join("\n\n") : "(empty transcript)";
}
