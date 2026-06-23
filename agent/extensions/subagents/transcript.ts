/**
 * transcript.ts — Read a persisted pi session JSONL into display lines, and
 * discover the current session's subagent transcripts on disk.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface DiskTranscript {
  /** Child session id (from the file header). */
  id: string;
  /** Absolute path to the .jsonl file. */
  file: string;
  /** Parent session id this child was spawned from. */
  parentSession?: string;
  /** First user prompt (the task), trimmed to one line. */
  task: string;
  /** mtime epoch ms, for sorting. */
  mtime: number;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const part = p as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string")
      out.push(part.text);
    else if (part.type === "toolCall")
      out.push(`[tool call: ${part.name ?? part.toolName ?? "?"}]`);
  }
  return out.join("");
}

/** First user-message text in a transcript file, one line, trimmed. */
function firstTask(file: string): string {
  try {
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === "message" && e.message?.role === "user") {
        return textOf(e.message.content).trim().split("\n")[0].slice(0, 80);
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** List subagent transcripts under a session dir that belong to `parentSessionId`. */
export function listSubagentTranscripts(
  sessionDir: string,
  parentSessionId: string | undefined,
): DiskTranscript[] {
  const dir = join(sessionDir, "subagents");
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
    let header: Record<string, unknown> | undefined;
    let mtime = 0;
    try {
      const first = readFileSync(file, "utf-8").split("\n", 1)[0];
      header = JSON.parse(first);
      mtime = Date.parse(String(header?.timestamp ?? "")) || 0;
    } catch {
      continue;
    }
    if (!header || header.type !== "session") continue;
    // Filter to this parent (when known). If parent unknown, include all.
    if (parentSessionId && header.parentSession !== parentSessionId) continue;
    out.push({
      id: String(header.id ?? basename(f, ".jsonl")),
      file,
      parentSession: header.parentSession as string | undefined,
      task: firstTask(file),
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
      const body = textOf(e.message?.content).trim();
      if (!body) continue;
      blocks.push(`── ${String(role).toUpperCase()} ──\n${body}`);
    }
  }
  return blocks.length ? blocks.join("\n\n") : "(empty transcript)";
}
