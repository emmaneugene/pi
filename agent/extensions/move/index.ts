import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  commandExists,
  copyToClipboard,
  resumeCommand,
} from "../../lib/session-resume.ts";
import { resolveUserPath } from "../../lib/paths.ts";

/**
 * /move <target-dir>
 *
 * Relocates the current session to another working directory by:
 *   1. Copying the session JSONL into the target dir's session folder,
 *      rewriting the header `cwd` and recording `parentSession`.
 *   2. Trashing the original file.
 *   3. Shutting pi down so nothing rewrites the now-deleted original.
 *
 * It deliberately does NOT hot-switch the live session: pi has no "cd" for a
 * running session, so switching into a different-cwd session would leave the
 * process cwd / tool execution dir pointing at the old directory. After the
 * move, resume in the target dir with:  cd <target> && pi -c
 */

// Encode an absolute path to pi's session folder name:
//   /Users/me/proj -> --Users-me-proj--
function encodeDir(absPath: string): string {
  const stripped = absPath.replace(/^\//, "").replace(/\/+$/, "");
  return `--${stripped.replaceAll("/", "-")}--`;
}

/**
 * Relocate the current session's subagent transcripts. Children live in a
 * per-parent folder `<sessionDir>/subagents/<parentSessionId>/`, so ownership
 * is structural — no header filtering. Each child still embeds an absolute
 * `cwd` inherited from the parent, so rewrite that as we copy into the
 * destination folder, then trash the original folder wholesale.
 */
function moveSubagentSessions(
  sourceSessionDir: string,
  destSessionDir: string,
  parentSessionId: string,
  targetCwd: string,
): { moved: number; failed: number } {
  const sourceDir = join(sourceSessionDir, "subagents", parentSessionId);
  if (!existsSync(sourceDir)) return { moved: 0, failed: 0 };

  let entries: string[];
  try {
    entries = readdirSync(sourceDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return { moved: 0, failed: 0 };
  }

  const destDir = join(destSessionDir, "subagents", parentSessionId);
  let moved = 0;
  let failed = 0;

  for (const name of entries) {
    let lines: string[];
    let header: { cwd?: string };
    try {
      lines = readFileSync(join(sourceDir, name), "utf8").split("\n");
      header = JSON.parse(lines[0]);
    } catch {
      failed++;
      continue; // unreadable/unparseable — leave the source folder in place
    }
    header.cwd = targetCwd;
    lines[0] = JSON.stringify(header);
    try {
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, name), lines.join("\n"));
      moved++;
    } catch {
      failed++;
    }
  }

  // Only trash the original folder once every child copied cleanly.
  if (moved > 0 && failed === 0) trashOrRemove(sourceDir);
  return { moved, failed };
}

function trashOrRemove(path: string): { method: "trash" | "rm"; ok: boolean } {
  if (commandExists("trash")) {
    const r = spawnSync("trash", [path], { stdio: "ignore" });
    return { method: "trash", ok: r.status === 0 };
  }
  try {
    // Fallback: permanent delete (handles both files and directories).
    rmSync(path, { force: true, recursive: true });
    return { method: "rm", ok: true };
  } catch {
    return { method: "rm", ok: false };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("move", {
    description:
      "Move the current session to another directory (then restart there)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/move requires an interactive session", "error");
        return;
      }

      const sm = ctx.sessionManager;
      const sourceFile = sm.getSessionFile();
      if (!sourceFile) {
        ctx.ui.notify("This session is ephemeral (no file to move)", "error");
        return;
      }

      const raw = (args ?? "").trim();
      if (!raw) {
        ctx.ui.notify("Usage: /move <target-directory>", "error");
        return;
      }

      // Resolve target dir relative to current cwd, expanding a leading ~.
      const targetDir = resolveUserPath(ctx.cwd, raw);

      if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
        ctx.ui.notify(
          `Target is not an existing directory: ${targetDir}`,
          "error",
        );
        return;
      }

      const currentCwd = sm.getCwd();
      if (resolve(targetDir) === resolve(currentCwd)) {
        ctx.ui.notify("Target directory is the current directory", "error");
        return;
      }

      // sessionsRoot = parent of the current session-dir, so we respect a
      // rebranded config dir name instead of assuming the default config path.
      const sessionsRoot = dirname(sm.getSessionDir());
      const destDir = join(sessionsRoot, encodeDir(resolve(targetDir)));
      const destFile = join(destDir, basename(sourceFile));

      if (existsSync(destFile)) {
        ctx.ui.notify(`Destination already exists: ${destFile}`, "error");
        return;
      }

      // Read + rewrite header (first JSONL line).
      let lines: string[];
      try {
        lines = readFileSync(sourceFile, "utf8").split("\n");
      } catch (e) {
        ctx.ui.notify(
          `Failed to read session: ${(e as Error).message}`,
          "error",
        );
        return;
      }
      let sessionId: string;
      try {
        const header = JSON.parse(lines[0]);
        header.cwd = resolve(targetDir);
        header.parentSession = sourceFile;
        sessionId = header.id;
        lines[0] = JSON.stringify(header);
      } catch (e) {
        ctx.ui.notify(
          `Could not parse session header: ${(e as Error).message}`,
          "error",
        );
        return;
      }

      // Write the relocated copy.
      try {
        mkdirSync(destDir, { recursive: true });
        writeFileSync(destFile, lines.join("\n"));
      } catch (e) {
        ctx.ui.notify(
          `Failed to write relocated session: ${(e as Error).message}`,
          "error",
        );
        return;
      }

      // Relocate subagent transcripts owned by this session before we trash
      // the parent, so children follow the parent into the new cwd.
      const subagents = moveSubagentSessions(
        sm.getSessionDir(),
        destDir,
        sessionId,
        resolve(targetDir),
      );

      // Skip session summary so setSessionName() doesn't resurrect a
      // session_info file in the original session dir
      pi.appendEntry("skip-summary", {});

      // Trash the original LAST, then shut down so the live SessionManager
      // never appends to (and resurrects) the old path.
      const del = trashOrRemove(sourceFile);

      // Put the resume command on the clipboard for a one-paste relaunch.
      const resumeCmd = resumeCommand(targetDir, sessionId);
      const copied = copyToClipboard(resumeCmd);

      if (!del.ok) {
        ctx.ui.notify(
          `Copied to ${destFile} but failed to remove original ${sourceFile}. Delete it manually.`,
          "error",
        );
      } else {
        const subMsg =
          subagents.moved > 0 || subagents.failed > 0
            ? ` (${subagents.moved} subagent session${subagents.moved === 1 ? "" : "s"} moved${subagents.failed > 0 ? `, ${subagents.failed} failed` : ""})`
            : "";
        ctx.ui.notify(
          `Moved to ${destFile}${subMsg}. Closing pi — ${copied ? "resume command copied to clipboard" : `resume with: ${resumeCmd}`}`,
          "info",
        );
      }

      ctx.shutdown();
    },
  });
}
