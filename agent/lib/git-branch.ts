/**
 * git-branch.ts — Which branch a working directory has checked out.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface GitBranch {
  /** Whether cwd is inside a git working tree. */
  isRepo: boolean;
  /** Branch name, absent on a detached HEAD (there is no name to report). */
  branch?: string;
}

/** Read the checked-out branch via `pi.exec`. Never throws. */
export async function detectGitBranch(
  pi: ExtensionAPI,
  cwd: string,
): Promise<GitBranch> {
  try {
    const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
    });
    if (result.code !== 0) return { isRepo: false };
    const branch = result.stdout.trim();
    // `--abbrev-ref` answers "HEAD" for a detached head, which is a state, not
    // a branch name.
    return {
      isRepo: true,
      branch: branch && branch !== "HEAD" ? branch : undefined,
    };
  } catch {
    // not a git repo, or git unavailable — fine
    return { isRepo: false };
  }
}
