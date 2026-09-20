/** /subagents — live and on-disk children in the shared catalog. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type CatalogEntry, showCatalog } from "../../lib/tui/picker.ts";
import type { SubagentManager } from "./manager.ts";
import {
  showSubagentSessionViewer,
  sourceForRecord,
  sourceForTranscript,
  type TranscriptSource,
} from "./session-viewer.ts";
import {
  type DiskTranscript,
  listSubagentTranscripts,
  renderTranscriptText,
} from "./transcript.ts";
import {
  settingSourceLabel,
  statusIcon,
  type InvocationSetting,
} from "./types.ts";
import { acknowledgeSettledFailure } from "./widget.ts";

function settingLabel(setting: InvocationSetting): string {
  return `${setting.value} (${settingSourceLabel(setting)})`;
}

function ageOf(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function transcriptArtifact(file?: string): CatalogEntry["artifact"] {
  return () => ({
    kind: "text",
    content: file ? renderTranscriptText(file) : "(no transcript yet)",
    ext: ".txt",
  });
}

function diskTranscripts(ctx: ExtensionContext): DiskTranscript[] {
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

function gatherEntries(
  manager: SubagentManager,
  disk: DiskTranscript[],
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seenFiles = new Set<string>();

  for (const r of manager.listAgents()) {
    if (r.transcriptFile) seenFiles.add(r.transcriptFile);
    const icon = statusIcon(r.status);
    entries.push({
      item: {
        value: r.id,
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

function sourceFor(
  manager: SubagentManager,
  disk: ReadonlyMap<string, DiskTranscript>,
  value: string,
): TranscriptSource | undefined {
  const record = manager.getRecord(value);
  if (record) {
    acknowledgeSettledFailure(record);
    return sourceForRecord(record, manager);
  }

  const transcript = disk.get(value);
  if (!transcript) return undefined;
  const title = transcript.invocation
    ? `${transcript.invocation.type} · ${transcript.invocation.description}`
    : transcript.task || "subagent";
  return sourceForTranscript(transcript.file, title, transcript.invocation);
}

async function openSessionViewer(
  ctx: ExtensionContext,
  manager: SubagentManager,
  disk: ReadonlyMap<string, DiskTranscript>,
  entries: CatalogEntry[],
  value: string,
): Promise<void> {
  const order = entries.map((entry) => entry.item.value);
  let index = Math.max(0, order.indexOf(value));
  for (;;) {
    const source = sourceFor(manager, disk, order[index] ?? value);
    if (!source) {
      ctx.ui.notify("Subagent transcript is no longer available.", "warning");
      return;
    }
    const exit = await showSubagentSessionViewer(ctx, source);
    if (exit.kind === "close") return;
    if (order.length < 2) return;
    index = (index + exit.delta + order.length) % order.length;
  }
}

export async function showSessionSubagents(
  ctx: ExtensionContext,
  manager: SubagentManager,
): Promise<void> {
  // Cache disk rows; live refresh only rebuilds in-memory labels.
  const disk = diskTranscripts(ctx);
  const diskByFile = new Map(disk.map((d) => [d.file, d]));
  const entries = () => gatherEntries(manager, disk);
  await showCatalog(ctx, "Subagents", entries, {
    refreshIntervalMs: 500,
    onSelect: (entry) =>
      openSessionViewer(ctx, manager, diskByFile, entries(), entry.item.value),
    onKill: (value) => {
      const rec = manager.getRecord(value);
      if (!rec) return { message: "Not a running subagent.", type: "warning" };
      if (rec.status !== "running" && rec.status !== "queued") {
        return { message: `Subagent is ${rec.status}.`, type: "warning" };
      }
      if (!manager.canSend(rec.id)) {
        return {
          message: "Subagent has already finished its work.",
          type: "warning",
        };
      }
      const ok = manager.abort(rec.id, { userAborted: true });
      return ok
        ? { message: "Subagent stopped.", type: "info" }
        : { message: "Could not stop subagent.", type: "warning" };
    },
  });
}
