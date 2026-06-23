import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

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

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function copyToClipboard(text: string): boolean {
  // Prefer clippy, then platform-native fallbacks.
  const candidates: Array<[string, string[]]> = [
    ["clippy", []],
    ["pbcopy", []],
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
  ];
  for (const [cmd, cmdArgs] of candidates) {
    if (spawnSync("which", [cmd], { stdio: "ignore" }).status !== 0) continue;
    const r = spawnSync(cmd, cmdArgs, {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (r.status === 0) return true;
  }
  return false;
}

function trashOrRemove(file: string): { method: "trash" | "rm"; ok: boolean } {
  const hasTrash =
    spawnSync("which", ["trash"], { stdio: "ignore" }).status === 0;
  if (hasTrash) {
    const r = spawnSync("trash", [file], { stdio: "ignore" });
    return { method: "trash", ok: r.status === 0 };
  }
  try {
    // Fallback: permanent delete.
    rmSync(file, { force: true });
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

      // Resolve target dir relative to current cwd, expand ~.
      const expanded = expandHome(raw);
      const targetDir = isAbsolute(expanded)
        ? expanded
        : resolve(ctx.cwd, expanded);

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
      // rebranded config dir name instead of hardcoding ~/.pi.
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

      // Skip session summary so setSessionName() doesn't resurrect a
      // session_info file in the original session dir
      pi.appendEntry("skip-summary", {});

      // Trash the original LAST, then shut down so the live SessionManager
      // never appends to (and resurrects) the old path.
      const del = trashOrRemove(sourceFile);

      // Put the resume command on the clipboard for a one-paste relaunch.
      const resumeCmd = `cd ${targetDir} && pi --session ${sessionId}`;
      const copied = copyToClipboard(resumeCmd);

      if (!del.ok) {
        ctx.ui.notify(
          `Copied to ${destFile} but failed to remove original ${sourceFile}. Delete it manually.`,
          "error",
        );
      } else {
        ctx.ui.notify(
          `Moved to ${destFile}. Closing pi — ${copied ? "resume command copied to clipboard" : `resume with: ${resumeCmd}`}`,
          "info",
        );
      }

      ctx.shutdown();
    },
  });
}
