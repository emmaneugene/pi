import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const COMMENT_POLL_MS = 200;

export interface HunkUserComment {
  noteId: string;
  source: "user";
  filePath: string;
  body: string;
  oldRange?: [number, number];
  newRange?: [number, number];
}

export type HunkViewerResult =
  | { status: "closed"; comments: HunkUserComment[] }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function hunkJson(args: string[]): Promise<unknown> {
  const result = await execFileAsync("hunk", args, {
    encoding: "utf8",
    timeout: 2_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

async function findSessionId(
  pid: number,
  patchPath: string,
): Promise<string | undefined> {
  const value = (await hunkJson(["session", "list", "--json"])) as {
    sessions?: Array<{
      sessionId?: unknown;
      pid?: unknown;
      sourceLabel?: unknown;
    }>;
  };
  const expectedSource = path.resolve(patchPath);
  const session = value.sessions?.find(
    (candidate) =>
      candidate.pid === pid ||
      (typeof candidate.sourceLabel === "string" &&
        path.resolve(candidate.sourceLabel) === expectedSource),
  );
  return typeof session?.sessionId === "string" ? session.sessionId : undefined;
}

function parseUserComments(value: unknown): HunkUserComment[] {
  if (!value || typeof value !== "object") return [];
  const comments = (value as { comments?: unknown }).comments;
  if (!Array.isArray(comments)) return [];
  return comments.flatMap((comment): HunkUserComment[] => {
    if (!comment || typeof comment !== "object") return [];
    const item = comment as Record<string, unknown>;
    if (
      item.source !== "user" ||
      typeof item.noteId !== "string" ||
      typeof item.filePath !== "string" ||
      typeof item.body !== "string"
    ) {
      return [];
    }
    const parsed: HunkUserComment = {
      noteId: item.noteId,
      source: "user",
      filePath: item.filePath,
      body: item.body,
    };
    if (
      Array.isArray(item.oldRange) &&
      typeof item.oldRange[0] === "number" &&
      typeof item.oldRange[1] === "number"
    ) {
      parsed.oldRange = [item.oldRange[0], item.oldRange[1]];
    }
    if (
      Array.isArray(item.newRange) &&
      typeof item.newRange[0] === "number" &&
      typeof item.newRange[1] === "number"
    ) {
      parsed.newRange = [item.newRange[0], item.newRange[1]];
    }
    return [parsed];
  });
}

async function readUserComments(sessionId: string): Promise<HunkUserComment[]> {
  return parseUserComments(
    await hunkJson([
      "session",
      "comment",
      "list",
      sessionId,
      "--type",
      "user",
      "--json",
    ]),
  );
}

async function runHunk(
  cwd: string,
  patchPath: string,
): Promise<HunkViewerResult> {
  return new Promise((resolve) => {
    const child = spawn("hunk", ["patch", patchPath], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    let sessionId: string | undefined;
    let latestComments: HunkUserComment[] = [];
    let running = true;

    const poll = async (): Promise<void> => {
      while (running) {
        try {
          sessionId ??= child.pid
            ? await findSessionId(child.pid, patchPath)
            : undefined;
          if (sessionId) latestComments = await readUserComments(sessionId);
        } catch {
          // Hunk's daemon may still be starting or may already be shutting down.
        }
        if (running) await delay(COMMENT_POLL_MS);
      }
    };
    const pollPromise = poll();

    child.once("error", (error: NodeJS.ErrnoException) => {
      running = false;
      resolve(
        error.code === "ENOENT"
          ? { status: "unavailable" }
          : {
              status: "failed",
              message: `Hunk failed to start: ${error.message}`,
            },
      );
    });
    child.once("close", async (code, signal) => {
      running = false;
      await pollPromise;
      if (sessionId) {
        try {
          latestComments = await readUserComments(sessionId);
        } catch {
          // The cached comments remain available after Hunk unregisters the session.
        }
      }
      if (code === 0) {
        resolve({ status: "closed", comments: latestComments });
      } else if (signal) {
        resolve({ status: "failed", message: `Hunk exited after ${signal}` });
      } else {
        resolve({
          status: "failed",
          message: `Hunk exited with code ${code ?? "unknown"}`,
        });
      }
    });
  });
}

export function composeReviewFeedback(comments: HunkUserComment[]): string {
  if (comments.length === 0) return "";
  const lines = ["Please address the following review feedback:", ""];
  comments.forEach((comment, index) => {
    const line = comment.newRange?.[0] ?? comment.oldRange?.[0];
    const side = comment.newRange ? "current" : "before turn";
    const location = line
      ? `${comment.filePath}:${line} (${side})`
      : comment.filePath;
    lines.push(`${index + 1}. ${location}`);
    lines.push(`   ${comment.body.trim().replace(/\n/g, "\n   ")}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

/** Open a recorded patch in Hunk while Pi releases the terminal. */
export async function openPatchInHunk(
  ctx: ExtensionContext,
  patch: string,
  cwd: string,
): Promise<HunkViewerResult> {
  let tempDir: string | undefined;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "pi-turn-diff-viewer-"));
    const patchPath = path.join(tempDir, "turn.patch");
    await writeFile(patchPath, patch, "utf8");

    return await ctx.ui.custom<HunkViewerResult>((tui, theme, _kb, done) => {
      setTimeout(async () => {
        tui.stop({ preserveScreen: true });
        tui.terminal.clearScreen();
        let result: HunkViewerResult;
        try {
          result = await runHunk(cwd, patchPath);
        } catch (error) {
          result = {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          };
        } finally {
          tui.start();
          tui.requestRender(true);
        }
        done(result);
      }, 0);
      return {
        render: () => [theme.fg("dim", " Opening last turn in Hunk…")],
        invalidate() {},
        handleInput() {},
      };
    });
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
