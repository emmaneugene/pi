import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type HunkViewerResult =
  | { status: "closed" }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

function runHunk(cwd: string, patchPath: string): Promise<HunkViewerResult> {
  return new Promise((resolve) => {
    const child = spawn("hunk", ["patch", patchPath], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      resolve(
        error.code === "ENOENT"
          ? { status: "unavailable" }
          : {
              status: "failed",
              message: `Hunk failed to start: ${error.message}`,
            },
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ status: "closed" });
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

/** Open a recorded patch in Hunk while Pi releases the terminal. */
export async function openPatchInHunk(
  ctx: ExtensionContext,
  patch: string,
  repoRoot: string,
): Promise<HunkViewerResult> {
  let tempDir: string | undefined;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "pi-turn-diff-viewer-"));
    const patchPath = path.join(tempDir, "turn.patch");
    await writeFile(patchPath, patch, "utf8");

    return await ctx.ui.custom<HunkViewerResult>((tui, theme, _kb, done) => {
      setTimeout(async () => {
        tui.stop();
        process.stdout.write("\x1b[2J\x1b[H");
        let result: HunkViewerResult;
        try {
          result = await runHunk(repoRoot, patchPath);
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
        render: () => [theme.fg("dim", " Opening turn diff in Hunk…")],
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
