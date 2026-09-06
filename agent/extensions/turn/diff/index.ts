import {
  isEditToolResult,
  isToolCallEventType,
  isWriteToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { resolveToolPath } from "../../../lib/paths.ts";
import {
  captureFile,
  displayPath,
  summarizeFiles,
  type TrackedFile,
  type TurnDiffData,
} from "./file-tracker.ts";
import { composeReviewFeedback, openPatchInHunk } from "./hunk-viewer.ts";

const ENTRY_TYPE = "turn-diff";
const MAX_CARD_FILES = 5;

function isTurnDiffData(value: unknown): value is TurnDiffData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TurnDiffData>;
  return (
    data.version === 3 &&
    typeof data.cwd === "string" &&
    Array.isArray(data.files) &&
    data.files.every(
      (file) =>
        file &&
        typeof file.path === "string" &&
        typeof file.patchPath === "string" &&
        typeof file.additions === "number" &&
        typeof file.deletions === "number",
    ) &&
    typeof data.additions === "number" &&
    typeof data.deletions === "number" &&
    (typeof data.patch === "string" || data.patch === null) &&
    typeof data.patchTruncated === "boolean"
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
  return (
    `Edited ${countLabel(data.files.length)}` +
    `  +${data.additions} -${data.deletions}`
  );
}

function fileSummary(
  file: TurnDiffData["files"][number],
  theme: Pick<Theme, "fg">,
): string {
  return (
    `  ${theme.fg("dim", file.path)}` +
    `  ${theme.fg("toolDiffAdded", `+${file.additions}`)}` +
    ` ${theme.fg("toolDiffRemoved", `-${file.deletions}`)}`
  );
}

export default function turnDiffExtension(pi: ExtensionAPI): void {
  // The in-progress run, or null between runs. A file is `confirmed` once an
  // edit or write on it succeeded.
  let run: {
    cwd: string;
    files: Map<string, TrackedFile & { confirmed: boolean }>;
    toolPaths: Map<string, string>;
  } | null = null;

  pi.registerEntryRenderer<TurnDiffData>(
    ENTRY_TYPE,
    (entry, _options, theme) => {
      if (!isTurnDiffData(entry.data)) return undefined;
      const data = entry.data;
      const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
      box.addChild(
        new Text(`${theme.fg("accent", "[last turn]")} ${summary(data)}`, 0, 0),
      );
      const displayedFiles = data.files.slice(0, MAX_CARD_FILES);
      for (const file of displayedFiles) {
        box.addChild(new Text(fileSummary(file, theme), 0, 0));
      }
      if (data.files.length > displayedFiles.length) {
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
      return box;
    },
  );

  pi.on("before_agent_start", async (_event, ctx) => {
    if (run) return;
    run = { cwd: ctx.cwd, files: new Map(), toolPaths: new Map() };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!run) return;
    if (
      !isToolCallEventType("edit", event) &&
      !isToolCallEventType("write", event)
    ) {
      return;
    }

    const absolutePath = resolveToolPath(event.input.path, ctx.cwd);
    run.toolPaths.set(event.toolCallId, absolutePath);
    if (run.files.has(absolutePath)) return;

    const captured = await captureFile(absolutePath);
    if (captured.status === "failed") {
      ctx.ui.notify(
        `Turn diff could not read ${absolutePath}: ${captured.message}`,
        "warning",
      );
      return;
    }
    // The await above may span the run's end.
    run?.files.set(absolutePath, {
      absolutePath,
      displayPath: displayPath(absolutePath, run.cwd),
      before: captured.snapshot,
      confirmed: false,
    });
  });

  pi.on("tool_result", (event) => {
    if (!run || event.isError) return;
    if (!isEditToolResult(event) && !isWriteToolResult(event)) return;
    const absolutePath = run.toolPaths.get(event.toolCallId);
    const file = absolutePath ? run.files.get(absolutePath) : undefined;
    if (file) file.confirmed = true;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!run) return;
    const { cwd, files } = run;
    run = null;
    const trackedFiles = [...files.values()].filter((file) => file.confirmed);

    try {
      const result = await summarizeFiles(cwd, trackedFiles);
      if (result.data) pi.appendEntry<TurnDiffData>(ENTRY_TYPE, result.data);
      if (result.warnings.length > 0) {
        ctx.ui.notify(
          `Turn diff skipped ${result.warnings.length} unreadable ${
            result.warnings.length === 1 ? "file" : "files"
          }`,
          "warning",
        );
      }
    } catch (error) {
      ctx.ui.notify(
        `Turn diff failed: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  });

  pi.registerCommand("turn-diff", {
    description: "Review the last turn's edits in Hunk",
    handler: async (args, ctx) => {
      const diff = latestDiff(ctx);
      if (!diff) {
        ctx.ui.notify("No recorded turn diff on this branch", "info");
        return;
      }
      if (args.trim() === "summary") {
        ctx.ui.notify(summary(diff), "info");
        return;
      }
      if (!diff.patch) {
        ctx.ui.notify(
          diff.patchTruncated
            ? "The last turn's patch exceeded 1 MB"
            : "The last turn has no reviewable patch",
          "warning",
        );
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify(summary(diff), "info");
        return;
      }

      const result = await openPatchInHunk(ctx, diff.patch, diff.cwd);
      if (result.status === "unavailable") {
        ctx.ui.notify("Hunk is not installed or not on PATH", "error");
      } else if (result.status === "failed") {
        ctx.ui.notify(result.message, "error");
      } else {
        const pathsByPatchPath = new Map(
          diff.files.map((file) => [file.patchPath, file.path]),
        );
        const comments = result.comments.map((comment) => ({
          ...comment,
          filePath: pathsByPatchPath.get(comment.filePath) ?? comment.filePath,
        }));
        const feedback = composeReviewFeedback(comments);
        if (feedback) {
          ctx.ui.pasteToEditor(feedback);
          ctx.ui.notify(
            `Inserted ${comments.length} Hunk ${
              comments.length === 1 ? "annotation" : "annotations"
            } into the editor`,
            "info",
          );
        }
      }
    },
  });
}

export const __testing = { isTurnDiffData, summary };
