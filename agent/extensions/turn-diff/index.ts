import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import {
  beginCapture,
  cleanupCapture,
  finishCapture,
  GitSnapshotError,
  type RepoCapture,
  type TurnDiffData,
} from "./git-snapshot.ts";
import { openPatchInHunk } from "./hunk-viewer.ts";

const ENTRY_TYPE = "turn-diff";
const MAX_RENDER_LINES = 800;

function isTurnDiffData(value: unknown): value is TurnDiffData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TurnDiffData>;
  return (
    data.version === 1 &&
    typeof data.repoRoot === "string" &&
    Array.isArray(data.files) &&
    typeof data.additions === "number" &&
    typeof data.deletions === "number"
  );
}

function latestDiff(ctx: ExtensionContext): TurnDiffData | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (
      entry?.type === "custom" &&
      entry.customType === ENTRY_TYPE &&
      isTurnDiffData(entry.data)
    ) {
      return entry.data;
    }
  }
  return undefined;
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function summary(data: TurnDiffData): string {
  const binaryCount = data.files.filter((file) => file.binary).length;
  const binary = binaryCount > 0 ? `  ${binaryCount} binary` : "";
  return (
    `Edited ${countLabel(data.files.length)}` +
    `  +${data.additions} -${data.deletions}${binary}`
  );
}

function renderPatch(patch: string, theme: Pick<Theme, "fg">): string {
  const lines = patch.split("\n");
  const limited = lines.slice(0, MAX_RENDER_LINES).map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return theme.fg("toolDiffAdded", line);
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return theme.fg("toolDiffRemoved", line);
    }
    if (line.startsWith("@@")) return theme.fg("accent", line);
    if (line.startsWith("diff --git")) {
      return theme.fg("accent", line);
    }
    return theme.fg("toolDiffContext", line);
  });
  if (lines.length > MAX_RENDER_LINES) {
    limited.push(
      theme.fg(
        "warning",
        `... ${lines.length - MAX_RENDER_LINES} more lines omitted`,
      ),
    );
  }
  return limited.join("\n");
}

function warnOnce(
  warnedCwds: Set<string>,
  ctx: ExtensionContext,
  message: string,
): void {
  if (warnedCwds.has(ctx.cwd)) return;
  warnedCwds.add(ctx.cwd);
  if (ctx.hasUI) ctx.ui.notify(`Turn diff disabled: ${message}`, "warning");
}

export default function turnDiffExtension(pi: ExtensionAPI): void {
  let activeCapture: RepoCapture | undefined;
  const warnedCwds = new Set<string>();

  pi.registerEntryRenderer<TurnDiffData>(
    ENTRY_TYPE,
    (entry, { expanded }, theme) => {
      if (!isTurnDiffData(entry.data)) return undefined;
      const data = entry.data;
      const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
      box.addChild(
        new Text(`${theme.fg("accent", "[last run]")} ${summary(data)}`, 0, 0),
      );
      const displayedFiles = expanded ? data.files : data.files.slice(0, 3);
      for (const file of displayedFiles) {
        const rename = file.oldPath ? `${file.oldPath} -> ` : "";
        box.addChild(
          new Text(
            theme.fg("dim", `  ${file.status} ${rename}${file.path}`),
            0,
            0,
          ),
        );
      }
      if (!expanded && data.files.length > displayedFiles.length) {
        box.addChild(
          new Text(
            theme.fg(
              "dim",
              `  ... ${data.files.length - displayedFiles.length} more`,
            ),
            0,
            0,
          ),
        );
      }
      if (expanded && data.patch) {
        box.addChild(new Text(renderPatch(data.patch, theme), 0, 1));
      } else if (expanded && data.patchTruncated) {
        box.addChild(
          new Text(
            theme.fg(
              "warning",
              "Patch exceeded 1 MB. Only the file summary was stored.",
            ),
            0,
            1,
          ),
        );
      }
      return box;
    },
  );

  pi.on("before_agent_start", async (_event, ctx) => {
    if (activeCapture) return;
    try {
      activeCapture = await beginCapture(ctx.cwd);
    } catch (error) {
      const message =
        error instanceof GitSnapshotError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      warnOnce(warnedCwds, ctx, message);
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const capture = activeCapture;
    activeCapture = undefined;
    if (!capture) return;
    try {
      const diff = await finishCapture(capture);
      if (diff) pi.appendEntry<TurnDiffData>(ENTRY_TYPE, diff);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnOnce(warnedCwds, ctx, message);
    }
  });

  pi.on("session_shutdown", async () => {
    const capture = activeCapture;
    activeCapture = undefined;
    if (capture) await cleanupCapture(capture);
  });

  pi.registerCommand("turn-diff", {
    description: "Open the most recent agent-run diff in Hunk",
    handler: async (args, ctx) => {
      const diff = latestDiff(ctx);
      if (!diff) {
        ctx.ui.notify("No recorded agent-run diff on this branch", "info");
        return;
      }
      if (args.trim() === "summary" || !diff.patch) {
        ctx.ui.notify(summary(diff), "info");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify(summary(diff), "info");
        return;
      }
      const result = await openPatchInHunk(ctx, diff.patch, diff.repoRoot);
      if (result.status === "unavailable") {
        ctx.ui.notify("Hunk is not installed or not on PATH", "error");
      } else if (result.status === "failed") {
        ctx.ui.notify(result.message, "error");
      }
    },
  });
}

export const __testing = {
  isTurnDiffData,
  renderPatch,
  summary,
};
