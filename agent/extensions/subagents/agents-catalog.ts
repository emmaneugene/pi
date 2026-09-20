/** /show-subagents — available types; Enter opens the agent .md. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type CatalogEntry, showCatalog } from "../../lib/tui/picker.ts";
import { BUILTIN_TOOLS } from "./gating.ts";
import type { AgentRegistry } from "./registry.ts";
import type { AgentConfig } from "./types.ts";

const ALL_BUILTINS = new Set<string>(BUILTIN_TOOLS);

function toolsLabel(allow: string[] | undefined): string {
  if (!allow) return "all tools";
  if (allow.length === 0) return "none";
  if (
    allow.length === ALL_BUILTINS.size &&
    allow.every((t) => ALL_BUILTINS.has(t))
  ) {
    return "all built-ins";
  }
  return allow.join(", ");
}

function toEntry(c: AgentConfig): CatalogEntry {
  const name = c.displayName?.trim() || c.name;
  const context = c.source ?? "global";
  const tools = toolsLabel(c.allowTools);
  const model = c.model?.trim() || "inherit";
  const thinking = c.thinking ?? "default";
  const enabled = c.enabled !== false;
  const mark = enabled ? "✔" : "✘";
  return {
    item: {
      value: c.name,
      label: name,
      description: `${mark} ${context} · ${tools} · ${model} · ${thinking} · ${c.promptMode}`,
    },
    artifact: () => ({ kind: "file", path: c.filePath }),
  };
}

export async function showAgentsCatalog(
  ctx: ExtensionCommandContext,
  registry: AgentRegistry,
): Promise<void> {
  registry.reload(ctx.cwd);
  await showCatalog(ctx, "Subagents", registry.list().map(toEntry));
}
