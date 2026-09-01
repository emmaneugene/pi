/** Applies an optional allowlist and a permanent denylist. */

import type { AgentConfig } from "./types.ts";

export const BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

/** Children cannot recurse or open UI prompts. */
export const DENIED_TOOLS = [
  "subagent",
  "get_subagent_result",
  "inspect_subagent",
  "steer_subagent",
  "AskUserQuestion",
] as const;

const DENIED = new Set<string>(DENIED_TOOLS);

export function isDeniedTool(name: string): boolean {
  return DENIED.has(name);
}

/** Resolve the allowlist after removing permanently denied tools. */
export function resolveAllowedTools(config: AgentConfig): string[] | undefined {
  if (!config.allowTools) return undefined;
  return [...new Set(config.allowTools)].filter((t) => !isDeniedTool(t));
}

/** Reapply both rules after extension tools register. */
export function filterActiveTools(
  active: string[],
  config: AgentConfig,
): string[] {
  const allowed = resolveAllowedTools(config);
  const permitted = allowed ? new Set(allowed) : undefined;
  return active.filter(
    (t) => !isDeniedTool(t) && (permitted ? permitted.has(t) : true),
  );
}
