/**
 * Minimal runtime environment detection for the system prompt header.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}

/** Detect git status + platform via pi.exec (never throws). */
export async function detectEnv(
  pi: ExtensionAPI,
  cwd: string,
): Promise<EnvInfo> {
  let isGitRepo = false;
  let branch = "";
  try {
    const r = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
    });
    if (r.code === 0) {
      isGitRepo = true;
      branch = r.stdout.trim();
    }
  } catch {
    // not a git repo, or git unavailable — fine
  }
  return { isGitRepo, branch, platform: process.platform };
}
