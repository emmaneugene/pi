/**
 * static tool gating.
 *
 * This is the entire "permissions" surface of this plugin. It is purely
 * static: an explicit allowlist from the agent's `allowTools`. Anything not
 * listed is unavailable, including extension-registered tools and this plugin's
 * own dispatch tools.
 *
 * Two enforcement points (see child-session.ts):
 *   1. pre-construction  — the `tools` allowlist passed to createAgentSession
 *                         gates built-in registration and the initial active set.
 *   2. post-bindExtensions — re-filter the active set with the same allowlist so
 *                           extension-registered tools are also covered.
 */

import type { AgentConfig } from "./types.ts";

/** pi built-in tool names. */
export const BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

/** Resolve the explicit tool allowlist for an agent. */
export function resolveAllowedTools(config: AgentConfig): string[] {
  return [...new Set(config.allowTools)];
}

/**
 * Apply the same explicit allowlist to the post-extension active tool set.
 * If a tool name is not listed in `tools:`, the child cannot use it.
 */
export function filterActiveTools(
  active: string[],
  config: AgentConfig,
): string[] {
  const allowed = new Set(resolveAllowedTools(config));
  return active.filter((t) => allowed.has(t));
}
