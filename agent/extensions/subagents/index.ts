import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { showAgentsCatalog } from "./agents-catalog.ts";
import { showSessionSubagents } from "./agents-menu.ts";
import { loadState, saveState, STATE_FILE } from "./config.ts";
import { SubagentManager } from "./manager.ts";
import {
  registerNotificationRenderer,
  SUBAGENT_NOTIFICATION_TYPE,
} from "./notification.ts";
import { AgentRegistry } from "./registry.ts";
import { resultOrReason } from "./termination.ts";
import { registerTools, SUBAGENT_TOOL_NAMES } from "./tools.ts";
import { type AgentRecord, SUBAGENTS_DISABLED_MESSAGE } from "./types.ts";
import {
  SubagentActivityWidget,
  selectWidgetRecords,
  type WidgetSelection,
} from "./widget.ts";

const MAX_CONCURRENT = 8;
const WIDGET_KEY = "onurpi-subagents-activity";
const OPEN_SHORTCUT = "ctrl+shift+a";

/** Installs the activity widget only while it has visible rows. */
class ActivityDisplay {
  private ctx: ExtensionContext | undefined;
  private installed = false;

  constructor(
    private readonly getRecords: () => readonly AgentRecord[],
    private enabled: boolean,
  ) {}

  setContext(ctx: ExtensionContext): void {
    this.ctx = ctx;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.sync();
    else this.remove();
  }

  sync(): void {
    if (!this.enabled) {
      this.remove();
      return;
    }
    const ctx = this.ctx;
    if (ctx?.mode !== "tui") return;
    const hasRows = this.select(Date.now()).shown.length > 0;
    if (hasRows === this.installed) return;
    if (!hasRows) {
      this.remove();
      return;
    }
    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) =>
        new SubagentActivityWidget(
          tui,
          theme,
          (now) => this.select(now),
          () => this.remove(),
          `${OPEN_SHORTCUT} subagents`,
        ),
      { placement: "aboveEditor" },
    );
    this.installed = true;
  }

  remove(): void {
    if (!this.installed) return;
    this.installed = false;
    this.ctx?.ui.setWidget(WIDGET_KEY, undefined);
  }

  private select(now: number): WidgetSelection {
    return selectWidgetRecords(this.getRecords(), now);
  }
}

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
  registerNotificationRenderer(pi);

  const registry = new AgentRegistry(process.cwd());
  let enabled = loadState().enabled;
  const isEnabled = () => enabled;

  const manager = new SubagentManager(registry, MAX_CONCURRENT);
  const display = new ActivityDisplay(() => manager.listAgents(), enabled);
  manager.setObservers({
    onSpawn: () => display.sync(),
    onComplete: (record) => {
      if (record.awaitResult) {
        // The result already reached the parent through the blocking tool call.
        display.sync();
        return;
      }
      const isError =
        record.status === "error" ||
        record.status === "aborted" ||
        record.status === "stopped";
      const summary = record.userAborted
        ? `Agent "${record.description}" was aborted by the user. Do not relaunch it unless asked.`
        : isError
          ? `Agent "${record.description}" ${record.status}. ${resultOrReason(record)}`
          : `Agent "${record.description}" completed (${record.toolUses} tool uses).\n\n${resultOrReason(record)}\n\nUse get_subagent_result for full output.`;
      display.sync();
      pi.sendMessage(
        {
          customType: SUBAGENT_NOTIFICATION_TYPE,
          content: summary,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
  });

  registerTools(pi, manager, registry, isEnabled);
  syncSubagentTools(pi, enabled);

  pi.registerCommand("toggle-subagents", {
    description: "Toggle subagents on/off",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      saveState({ enabled });
      syncSubagentTools(pi, enabled);
      display.setContext(ctx);
      display.setEnabled(enabled);
      if (!enabled) {
        // Do not retain stopped rows that cannot be acknowledged while the
        // extension is disabled. Their later promise settlement is ignored.
        manager.abortAndDiscardAll();
      }
      ctx.ui.notify(
        enabled
          ? `Subagents enabled (${STATE_FILE})`
          : `Subagents disabled (${STATE_FILE})`,
        "info",
      );
    },
  });

  pi.registerCommand("subagents", {
    description: "List this session's subagents and view live transcripts",
    handler: async (_args, ctx) => {
      if (!isEnabled()) {
        ctx.ui.notify(SUBAGENTS_DISABLED_MESSAGE, "warning");
        return;
      }
      display.setContext(ctx);
      await showSessionSubagents(ctx, manager);
    },
  });

  pi.registerCommand("show-subagents", {
    description: "Show subagent types available to the agent in this session",
    handler: async (_args, ctx) => {
      await showAgentsCatalog(ctx, registry);
    },
  });

  pi.registerShortcut(OPEN_SHORTCUT, {
    description: "List this session's subagents",
    handler: async (ctx) => {
      if (!isEnabled()) {
        ctx.ui.notify(SUBAGENTS_DISABLED_MESSAGE, "warning");
        return;
      }
      display.setContext(ctx);
      await showSessionSubagents(ctx, manager);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    manager.clearCompleted();
    display.setContext(ctx);
    display.setEnabled(enabled);
    syncSubagentTools(pi, enabled);
  });
  // Abort all children when the parent turn is interrupted / on shutdown.
  // A spawn can only happen inside a turn, so refreshing the context here keeps
  // the widget usable without threading ctx through the manager's observers.
  pi.on("before_agent_start", (_event, ctx) => {
    display.setContext(ctx);
    syncSubagentTools(pi, enabled);
  });
  pi.on("session_shutdown", () => {
    // session_before_switch can be cancelled by another extension. Wait for
    // shutdown, which only fires once the parent session is actually leaving.
    display.setEnabled(false);
    manager.abortAndDiscardAll();
  });
}
