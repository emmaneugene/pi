/**
 * Path helpers shared across extensions.
 *
 * Lives in agent/lib/ so extensions can share it without importing across
 * extension boundaries.
 *
 * Two resolvers, for two different contracts:
 *   - `resolveUserPath` for a path a human typed into a command.
 *   - `resolveToolPath` for a path a model passed to a tool, which must land on
 *     the same file pi's built-in file tools would touch.
 */

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Resolve a path a model supplied to a tool. This must match what pi's
 * built-in file tools do.
 *
 * Those built-in tools call `resolvePath(filePath, cwd, {
 * normalizeUnicodeSpaces: true, stripAtPrefix: true })` from the CLI's own
 * `src/utils/paths.ts`. That function is not exported, so this function
 * mirrors it for that exact option set.
 *
 * Note: this function does not trim the input, and neither does upstream. A
 * filename with meaningful trailing whitespace must keep that whitespace;
 * stripping it would resolve to a different file.
 */
export function resolveToolPath(input: string, cwd: string): string {
  let normalized = input.replace(UNICODE_SPACES, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);

  if (normalized === "~") {
    normalized = homedir();
  } else if (
    normalized.startsWith("~/") ||
    (process.platform === "win32" && normalized.startsWith("~\\"))
  ) {
    normalized = join(homedir(), normalized.slice(2));
  } else if (/^file:\/\//.test(normalized)) {
    normalized = fileURLToPath(normalized);
  }

  return isAbsolute(normalized)
    ? resolve(normalized)
    : resolve(cwd, normalized);
}
