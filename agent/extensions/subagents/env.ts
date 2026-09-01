/**
 * Minimal runtime environment detection for the system prompt header.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectGitBranch } from "../../lib/git-branch.ts";

export interface EnvInfo {
  isGitRepo: boolean;
  branch: string;
  platform: string;
}

/** Detect git status + platform (never throws). */
export async function detectEnv(
  pi: ExtensionAPI,
  cwd: string,
): Promise<EnvInfo> {
  const git = await detectGitBranch(pi, cwd);
  return {
    isGitRepo: git.isRepo,
    branch: git.branch ?? "",
    platform: process.platform,
  };
}
