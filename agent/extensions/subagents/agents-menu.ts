/**
 * /subagents — list this session's subagents (live in-memory records + past
 * transcripts on disk) in the shared catalog overlay. Enter opens a read-only
 * native session viewer; the configured external-editor key retains the prior
 * rendered-transcript editor flow.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type CatalogEntry, showCatalog } from "../../lib/tui/picker.ts";
import type { SubagentManager } from "./manager.ts";
import {
  showSubagentSessionViewer,
  sourceForRecord,
  sourceForTranscript,
} from "./session-viewer.ts";
import {
  type DiskTranscript,
  listSubagentTranscripts,
  renderTranscriptText,
} from "./transcript.ts";
import type { InvocationSetting } from "./types.ts";

const ICON: Record<string, string> = {
  running: "●",
  queued: "◌",
  completed: "✓",
  steered: "✓",
  error: "✗",
  aborted: "✗",
  stopped: "■",
};

function settingLabel(setting: InvocationSetting): string {
  const source =
    setting.source === "tool override"
      ? "override"
      : setting.source === "agent definition"
        ? "definition"
        : setting.source === "inherited/default"
          ? "inherited"
          : "unknown";
  return `${setting.value} (${source})`;
}

function ageOf(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/** The session-history artefact for a transcript file (rendered, read-only). */
function transcriptArtifact(file?: string): CatalogEntry["artifact"] {
  return () => ({
    content: file ? renderTranscriptText(file) : "(no transcript yet)",
    ext: ".txt",
  });
}

function diskTranscripts(ctx: ExtensionCommandContext): DiskTranscript[] {
  try {
    const sessionDir = ctx.sessionManager?.getSessionDir?.() ?? "";
    const sessionId = ctx.sessionManager?.getSessionId?.();
    return sessionDir ? listSubagentTranscripts(sessionDir, sessionId) : [];
  } catch {
    return [];
  }
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Merge live records (first) with disk-only transcripts into catalog entries. */
function gatherEntries(
  manager: SubagentManager,
  disk: DiskTranscript[],
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seenFiles = new Set<string>();

  for (const r of manager.listAgents()) {
    if (r.transcriptFile) seenFiles.add(r.transcriptFile);
    const icon = ICON[r.status] ?? "·";
    entries.push({
      item: {
        value: r.transcriptFile ?? `record:${r.id}`,
        label: `${r.type} · ${r.description}`,
        description: `${icon} ${r.status} · ${settingLabel(r.invocation.model)} · ${settingLabel(r.invocation.thinking)} · ${countLabel(r.turns, "turn")} · ${countLabel(r.toolUses, "tool")} · ${ageOf(r.startedAt)}`,
      },
      artifact: transcriptArtifact(r.transcriptFile),
    });
  }

  for (const d of disk) {
    if (seenFiles.has(d.file)) continue; // already shown as a live record
    const invocation = d.invocation;
    entries.push({
      item: {
        value: d.file,
        label: invocation
          ? `${invocation.type} · ${invocation.description}`
          : d.task || "subagent",
        description: invocation
          ? `○ on disk · ${settingLabel(invocation.model)} · ${settingLabel(invocation.thinking)} · ${countLabel(d.turns, "turn")} · ${ageOf(d.mtime)}`
          : `○ on disk · model unknown · thinking unknown · ${countLabel(d.turns, "turn")} · ${ageOf(d.mtime)}`,
      },
      artifact: transcriptArtifact(d.file),
    });
  }
  return entries;
}

async function openSessionViewer(
  ctx: ExtensionCommandContext,
  manager: SubagentManager,
  value: string,
): Promise<void> {
  const record = manager
    .listAgents()
    .find((r) => (r.transcriptFile ?? `record:${r.id}`) === value);
  if (record) {
    await showSubagentSessionViewer(ctx, sourceForRecord(record));
    return;
  }

  const transcript = diskTranscripts(ctx).find((d) => d.file === value);
  if (!transcript) {
    ctx.ui.notify("Subagent transcript is no longer available.", "warning");
    return;
  }
  const title = transcript.invocation
    ? `${transcript.invocation.type} · ${transcript.invocation.description}`
    : transcript.task || "subagent";
  await showSubagentSessionViewer(
    ctx,
    sourceForTranscript(transcript.file, title, transcript.invocation),
  );
}

export async function showSessionSubagents(
  ctx: ExtensionCommandContext,
  manager: SubagentManager,
): Promise<void> {
  // Disk-only rows are immutable while this picker is open. Cache them so the
  // live refresh only rebuilds labels from cheap in-memory agent records.
  const disk = diskTranscripts(ctx);
  await showCatalog(ctx, "Subagents", () => gatherEntries(manager, disk), {
    refreshIntervalMs: 500,
    onSelect: (entry) => openSessionViewer(ctx, manager, entry.item.value),
    // ctrl+x stops the highlighted subagent if it's still running.
    onKill: (value) => {
      const rec = manager
        .listAgents()
        .find((r) => (r.transcriptFile ?? `record:${r.id}`) === value);
      if (!rec) return { message: "Not a running subagent.", type: "warning" };
      if (rec.status !== "running" && rec.status !== "queued") {
        return { message: `Subagent is ${rec.status}.`, type: "warning" };
      }
      const ok = manager.abort(rec.id, { userAborted: true });
      return ok
        ? { message: "Subagent stopped.", type: "info" }
        : { message: "Could not stop subagent.", type: "warning" };
    },
  });
}
