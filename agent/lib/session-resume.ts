/**
 * Shared helpers for session commands (/move, /continue, /side).
 *
 * Lives in agent/lib/ (outside extensions/), so it is never scanned by the
 * extension loader; it is a plain module imported by the extension files.
 */

import { spawnSync } from "node:child_process";

export function commandExists(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

export function copyToClipboard(text: string): boolean {
  // Prefer clippy, then platform-native fallbacks.
  const candidates: Array<[string, string[]]> = [
    ["clippy", []],
    ["pbcopy", []],
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
  ];
  for (const [cmd, cmdArgs] of candidates) {
    if (!commandExists(cmd)) continue;
    const r = spawnSync(cmd, cmdArgs, {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (r.status === 0) return true;
  }
  return false;
}

export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * The one-paste command to resume a session in its working directory. Single
 * source of truth for the resume syntax shared by /move and /continue.
 */
export function resumeCommand(cwd: string, sessionId: string): string {
  return `cd ${shellQuote(cwd)} && pi --session ${shellQuote(sessionId)}`;
}
