/**
 * Lists this session's subagents (live in-memory records + past transcripts on
 * disk), and lets you view a transcript or stop a running one.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubagentManager } from "./manager.ts";
import {
  type DiskTranscript,
  listSubagentTranscripts,
  renderTranscriptText,
} from "./transcript.ts";

interface Entry {
  label: string;
  status: string;
  file?: string;
  recordId?: string;
  running: boolean;
}

const ICON: Record<string, string> = {
  running: "●",
  queued: "◌",
  completed: "✓",
  steered: "✓",
  error: "✗",
  aborted: "✗",
  stopped: "■",
};

function ageOf(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/** Build the merged entry list: live records first, then disk-only transcripts. */
function gatherEntries(
  ctx: ExtensionCommandContext,
  manager: SubagentManager,
): Entry[] {
  const entries: Entry[] = [];
  const seenFiles = new Set<string>();

  for (const r of manager.listAgents()) {
    if (r.transcriptFile) seenFiles.add(r.transcriptFile);
    const icon = ICON[r.status] ?? "·";
    entries.push({
      label: `${icon} ${r.type}  ${r.description}  —  ${r.status} · ${r.toolUses} tools · ${ageOf(r.startedAt)}`,
      status: r.status,
      file: r.transcriptFile,
      recordId: r.id,
      running: r.status === "running" || r.status === "queued",
    });
  }

  let sessionDir = "";
  let sessionId: string | undefined;
  try {
    sessionDir = ctx.sessionManager?.getSessionDir?.() ?? "";
    sessionId = ctx.sessionManager?.getSessionId?.();
  } catch {
    /* headless */
  }
  if (sessionDir) {
    const disk: DiskTranscript[] = listSubagentTranscripts(
      sessionDir,
      sessionId,
    );
    for (const d of disk) {
      if (seenFiles.has(d.file)) continue; // already shown as a live record
      entries.push({
        label: `○ ${d.task || "subagent"}  —  on disk · ${ageOf(d.mtime)}`,
        status: "on disk",
        file: d.file,
        running: false,
      });
    }
  }
  return entries;
}

export async function showAgentsMenu(
  ctx: ExtensionCommandContext,
  manager: SubagentManager,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/agents requires an interactive session", "error");
    return;
  }

  // Outer loop: re-list after each action so statuses stay fresh.
  for (;;) {
    const entries = gatherEntries(ctx, manager);
    if (entries.length === 0) {
      ctx.ui.notify("No subagents in this session yet.", "info");
      return;
    }

    const CLOSE = "‹ Close";
    const choice = await ctx.ui.select("Subagents", [
      ...entries.map((e) => e.label),
      CLOSE,
    ]);
    if (!choice || choice === CLOSE) return;
    const entry = entries.find((e) => e.label === choice);
    if (!entry) return;

    // Action menu for the selected agent.
    const actions: string[] = [];
    if (entry.file) actions.push("View transcript");
    if (entry.recordId && entry.running) actions.push("Stop");
    actions.push("‹ Back");

    const action = await ctx.ui.select(choice, actions);
    if (!action || action === "‹ Back") continue;

    if (action === "View transcript" && entry.file) {
      // Open the rendered transcript in $EDITOR (pi's ctrl+g mechanism): full
      // native scrolling, vim motions, and / search for free. Read-only by
      // intent — the edited result is discarded and the real .jsonl is untouched
      // (ctx.ui.editor edits a throwaway buffer, not the file).
      await ctx.ui.editor(entry.label, renderTranscriptText(entry.file));
      continue;
    }

    if (action === "Stop" && entry.recordId) {
      const ok = manager.abort(entry.recordId);
      ctx.ui.notify(
        ok ? "Agent stopped." : "Could not stop agent.",
        ok ? "info" : "warning",
      );
      continue;
    }
  }
}
