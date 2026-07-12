/**
 * Subagent extension composition root.
 *
 * Tools: subagent · get_subagent_result · steer_subagent
 * Tool access: explicit allowlist per agent type.
 * Wires the registry, manager, tools, slash commands, and completion notices.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showAgentsCatalog } from "./agents-catalog.ts";
import { showSessionSubagents } from "./agents-menu.ts";
import { loadState, saveState, STATE_FILE } from "./config.ts";
import { SubagentManager } from "./manager.ts";
import { AgentRegistry } from "./registry.ts";
import { registerTools, SUBAGENT_TOOL_NAMES } from "./tools.ts";

const MAX_CONCURRENT = 4;
const DISABLED_MESSAGE =
  "Subagents are disabled. Run /toggle-subagents to enable them.";

function syncSubagentTools(pi: ExtensionAPI, enabled: boolean): void {
  try {
    const subagentTools = new Set<string>(SUBAGENT_TOOL_NAMES);
    const active = pi.getActiveTools();
    const next = enabled
      ? [...new Set([...active, ...SUBAGENT_TOOL_NAMES])]
      : active.filter((name) => !subagentTools.has(name));
    const changed =
      next.length !== active.length ||
      next.some((name, i) => name !== active[i]);
    if (changed) pi.setActiveTools(next);
  } catch {
    // Tool state is not bound during early extension load in some modes.
  }
}

export default function (pi: ExtensionAPI) {
  const registry = new AgentRegistry(process.cwd());
  let enabled = loadState().enabled;
  const isEnabled = () => enabled;

  const manager = new SubagentManager(
    registry,
    MAX_CONCURRENT,
    // onComplete: notify the orchestrator when a BACKGROUND agent finishes.
    (record) => {
      const isError =
        record.status === "error" ||
        record.status === "aborted" ||
        record.status === "stopped";
      const summary = record.userAborted
        ? `Background agent "${record.description}" was aborted by the user. Do not relaunch it unless asked.`
        : isError
          ? `Background agent "${record.description}" ${record.status}: ${record.error ?? "stopped"}.`
          : `Background agent "${record.description}" completed (${record.toolUses} tool uses).\n\n${record.result ?? "No output."}\n\nUse get_subagent_result for full output.`;
      pi.sendMessage(
        {
          customType: "subagent-notification",
          content: summary,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
  );

  registerTools(pi, manager, registry, isEnabled);
  syncSubagentTools(pi, enabled);

  pi.registerCommand("toggle-subagents", {
    description: "Toggle subagents on/off",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      saveState({ enabled });
      syncSubagentTools(pi, enabled);
      if (!enabled) manager.abortAll();
      ctx.ui.notify(
        enabled
          ? `Subagents enabled (${STATE_FILE})`
          : `Subagents disabled (${STATE_FILE})`,
        "info",
      );
    },
  });

  // /subagents — list this session's subagents (live + on-disk) in the catalog.
  // Enter opens the live read-only session viewer; the external-editor key
  // retains the rendered transcript editor flow.
  pi.registerCommand("subagents", {
    description: "List this session's subagents and view live transcripts",
    handler: async (_args, ctx) => {
      if (!isEnabled()) {
        ctx.ui.notify(DISABLED_MESSAGE, "warning");
        return;
      }
      await showSessionSubagents(ctx, manager);
    },
  });

  // /show-subagents — read-only catalog of available subagent types and their
  // config (context, tools, model, thinking, prompt mode). Parallel to
  // /show-skills and /show-tools.
  pi.registerCommand("show-subagents", {
    description: "Show subagent types available to the agent in this session",
    handler: async (_args, ctx) => {
      await showAgentsCatalog(ctx, registry);
    },
  });

  // Reset tracked agents on session boundaries so prior-session agents don't leak.
  pi.on("session_start", () => {
    manager.clearCompleted();
    syncSubagentTools(pi, enabled);
  });
  pi.on("session_before_switch", () => manager.clearCompleted());

  // Abort all children when the parent turn is interrupted / on shutdown.
  pi.on("before_agent_start", () => {
    syncSubagentTools(pi, enabled);
  });
  pi.on("turn_start", () => {
    /* fresh turn — nothing to clean; children abort via their own signals */
  });
  pi.on("session_shutdown", () => manager.abortAll());
}
