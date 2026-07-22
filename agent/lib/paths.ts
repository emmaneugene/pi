/**
 * Path helpers shared across extensions.
 *
 * Lives in agent/lib/ so extensions can share it without importing across
 * extension boundaries.
 */

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Resolve a user-supplied path to an absolute path:
 *   - a leading `~` or `~/` expands to the home directory,
 *   - anything still relative is resolved against `cwd`.
 *
 * A bare `~user` (no slash) is treated literally, not as another user's home.
 */
export function resolveUserPath(cwd: string, input: string): string {
  let p = input;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(cwd, p);
}
