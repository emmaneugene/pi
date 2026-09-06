/**
 * tools.ts — The LLM-callable tools: subagent, get_subagent_result,
 * steer_subagent. Thin dispatch over the manager.
 */

import { dirname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  defineTool,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { renderExpandableToolResult } from "../../lib/expandable-tool-result.ts";
import { inspectActivity } from "./activity.ts";
import type { SubagentManager } from "./manager.ts";
import { findModel, suggestModels } from "./models.ts";
import type { AgentRegistry } from "./registry.ts";
import { resultOrReason } from "./termination.ts";
import {
  isThinkingLevel,
  settingSourceLabel,
  SUBAGENTS_DISABLED_MESSAGE,
  THINKING_LEVELS,
  type AgentRecord,
  type SubagentInvocation,
  type SubagentType,
} from "./types.ts";

export const SUBAGENT_TOOL_NAMES = [
  "subagent",
  "get_subagent_result",
  "inspect_subagent",
  "steer_subagent",
] as const;

interface SubagentToolDetails {
  agentId?: string;
  invocation?: SubagentInvocation;
}

function textResult(text: string, details?: SubagentToolDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

function invocationLine(invocation: SubagentInvocation): string {
  return `${invocation.type} · ${invocation.model.value} (${settingSourceLabel(invocation.model)}) · ${invocation.thinking.value} (${settingSourceLabel(invocation.thinking)})`;
}

/** Format a completion or status line for the orchestrator. */
function describe(r: AgentRecord): string {
  const head = `Agent "${r.description}" ${r.status} (${r.toolUses} tool uses).`;
  const transcript = r.transcriptFile
    ? `\n\nTranscript: ${r.transcriptFile}`
    : "";
  return `${head}\n\n${resultOrReason(r)}${transcript}`;
}

export function registerTools(
  pi: import("@earendil-works/pi-coding-agent").ExtensionAPI,
  manager: SubagentManager,
  registry: AgentRegistry,
  isEnabled: () => boolean,
): void {
  const types = () => registry.availableTypes().join(", ");
  const globalAgentsDir = join(dirname(getAgentDir()), "agents");
  const invocationsByCall = new Map<string, SubagentInvocation>();

  // ── subagent ────────────────────────────────────────────────────────────
  pi.registerTool(
    defineTool({
      name: SUBAGENT_TOOL_NAMES[0],
      label: "Subagent",
      description:
        `Launch a sub-agent for a multi-step task. Each runs asynchronously in a fresh session with its own tool scope and system prompt. It has NOT seen this conversation, so the prompt must be self-contained.\n\n` +
        `Available types: ${types()}. Custom agents live in ${CONFIG_DIR_NAME}/agents/<name>.md (project) or ${globalAgentsDir}/<name>.md (global).\n\n` +
        `- description: 3-5 words, shown in the UI.\n` +
        `- Returns an id immediately; you are notified on completion (never poll). Pass wait: true to block until the agent finishes and get its result inline — several wait spawns in one message run in parallel and their results return together.\n` +
        `- The result is not shown to the user — summarize it for them. Verify claimed code changes before reporting work done.`,
      parameters: Type.Object({
        prompt: Type.String({
          description: "Self-contained task for the agent.",
        }),
        description: Type.String({
          description: "Short 3-5 word task description (UI).",
        }),
        subagent_type: Type.String({
          description: `Agent type. One of: ${types()}.`,
        }),
        model: Type.Optional(
          Type.String({
            description:
              'Model override: an exact "provider/id" (e.g. "anthropic/claude-sonnet-5") or a unique substring of a model id. An unknown id is rejected with the closest available ids. Never append an effort suffix such as ":xhigh" — set reasoning effort with `thinking`.',
          }),
        ),
        thinking: Type.Optional(
          Type.Union(
            THINKING_LEVELS.map((level) => Type.Literal(level)),
            {
              description: `Reasoning effort override, clamped to what the chosen model supports. One of: ${THINKING_LEVELS.join(", ")}. Overrides the agent definition's level.`,
            },
          ),
        ),
        max_turns: Type.Optional(
          Type.Number({
            description: "Max agentic turns. Omit for unlimited.",
            minimum: 1,
          }),
        ),
        inherit_context: Type.Optional(
          Type.Boolean({
            description:
              "Prepend a compact recent excerpt from the parent conversation (default false).",
          }),
        ),
        wait: Type.Optional(
          Type.Boolean({
            description:
              "Block until the agent finishes and return its result inline, instead of returning an id and notifying later. Launch several wait spawns in one message to run them in parallel and collect all results at once.",
          }),
        ),
      }),
      execute: async (
        toolCallId,
        params,
        signal,
        _onUpdate,
        ctx: ExtensionContext,
      ) => {
        if (!isEnabled()) return textResult(SUBAGENTS_DISABLED_MESSAGE);
        registry.reload(ctx.cwd);
        const type = params.subagent_type as SubagentType;
        if (!registry.isAvailable(type)) {
          return textResult(
            `Unknown or disabled subagent type "${params.subagent_type}". Available types: ${types()}.`,
          );
        }
        // This function rejects a model reference that does not resolve. It
        // does not silently replace that reference with the parent model,
        // because the caller cannot correct a substitution it is never told
        // about.
        const model = findModel(params.model, ctx.scopedModels);
        if (params.model && !model) {
          const suggestions = suggestModels(params.model, ctx.scopedModels);
          return textResult(
            `Unknown model "${params.model}". ${
              suggestions.length > 0
                ? `Closest available: ${suggestions.join(", ")}.`
                : "No models are available in this session."
            } Pass an exact provider/id; model ids carry no effort suffix, so set reasoning effort with the "thinking" parameter instead.`,
          );
        }
        if (params.thinking && !isThinkingLevel(params.thinking)) {
          return textResult(
            `Unknown thinking level "${params.thinking}". One of: ${THINKING_LEVELS.join(", ")}.`,
          );
        }

        const id = manager.spawn(pi, ctx, type, params.prompt, {
          description: params.description,
          model,
          thinkingLevel: params.thinking,
          maxTurns: params.max_turns,
          inheritContext: params.inherit_context,
          awaitResult: params.wait,
          signal: ctx.signal,
        });
        const invocation = manager.getRecord(id)!.invocation;
        invocationsByCall.set(toolCallId, invocation);
        if (!params.wait) {
          return textResult(
            `Launched agent "${params.description}" (id: ${id}). You will be notified on completion.\n${invocationLine(invocation)}`,
            { agentId: id, invocation },
          );
        }
        // ctx.signal already aborts the child on a parent interrupt; this
        // listener covers the tool-call-level signal. Settling instead of
        // rejecting keeps partial output plus its termination note as the result.
        const onInterrupt = () => manager.abort(id);
        signal?.addEventListener("abort", onInterrupt, { once: true });
        const settled = await manager.whenSettled(id);
        signal?.removeEventListener("abort", onInterrupt);
        if (!settled) {
          return textResult(
            `Agent "${params.description}" (${id}) was discarded before it finished; the parent session switched away.`,
            { agentId: id, invocation },
          );
        }
        return textResult(describe(settled), { agentId: id, invocation });
      },
      renderCall(params, theme, context) {
        const invocation = invocationsByCall.get(context.toolCallId);
        const config = registry.isAvailable(params.subagent_type)
          ? registry.resolve(params.subagent_type)
          : undefined;
        const model = invocation?.model ?? {
          value: params.model ?? config?.model ?? "inherit",
          source: params.model
            ? ("tool override" as const)
            : config?.model
              ? ("agent definition" as const)
              : ("inherited/default" as const),
        };
        const thinking = invocation?.thinking ?? {
          value: params.thinking ?? config?.thinking ?? pi.getThinkingLevel(),
          source: params.thinking
            ? ("tool override" as const)
            : config?.thinking
              ? ("agent definition" as const)
              : ("inherited/default" as const),
        };
        const description = params.description || "subagent";
        const type = invocation?.type ?? params.subagent_type ?? "unknown";
        const text =
          theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", description) +
          `\n  ${theme.fg("muted", type)} ${theme.fg("dim", `· ${model.value} (${settingSourceLabel(model)}) · ${thinking.value} (${settingSourceLabel(thinking)})`)}`;
        return new Text(text, 0, 0);
      },
      renderResult(result, _options, theme, context) {
        const details = result.details as SubagentToolDetails | undefined;
        if (details?.invocation && !invocationsByCall.has(context.toolCallId)) {
          invocationsByCall.set(context.toolCallId, details.invocation);
          context.invalidate();
        }
        const content = result.content[0];
        const text =
          content?.type === "text"
            ? content.text
            : "Subagent returned no output.";
        return new Text(theme.fg("toolOutput", text), 0, 0);
      },
    }),
  );

  // ── get_subagent_result ─────────────────────────────────────────────────
  pi.registerTool(
    defineTool({
      name: SUBAGENT_TOOL_NAMES[1],
      label: "Get subagent result",
      description:
        "Check the status/result of an asynchronous sub-agent by id.",
      parameters: Type.Object({
        agent_id: Type.String({ description: "The agent id." }),
      }),
      execute: async (_id, params) => {
        if (!isEnabled()) return textResult(SUBAGENTS_DISABLED_MESSAGE);
        const r = manager.getRecord(params.agent_id);
        if (!r) return textResult(`No agent with id "${params.agent_id}".`);
        if (r.status === "running" || r.status === "queued") {
          return textResult(
            `Agent "${r.description}" is ${r.status} (${r.toolUses} tool uses so far).`,
          );
        }
        return textResult(describe(r));
      },
      renderResult: renderExpandableToolResult,
    }),
  );

  // ── inspect_subagent ────────────────────────────────────────────────────
  pi.registerTool(
    defineTool({
      name: SUBAGENT_TOOL_NAMES[2],
      label: "Inspect subagent",
      description:
        "Inspect a bounded snapshot of a sub-agent's recent activity when you need evidence to steer it. Do not use this to poll for completion; completion is delivered automatically.",
      parameters: Type.Object({
        agent_id: Type.String({ description: "The agent id." }),
        since_cursor: Type.Optional(
          Type.Integer({
            description:
              "Cursor from a prior inspection. Returns only newer settled activity when available.",
            minimum: 0,
          }),
        ),
        max_events: Type.Optional(
          Type.Integer({
            description:
              "Maximum recent events to return (default 12, max 30).",
            minimum: 1,
            maximum: 30,
          }),
        ),
      }),
      execute: async (_id, params) => {
        if (!isEnabled()) return textResult(SUBAGENTS_DISABLED_MESSAGE);
        const record = manager.getRecord(params.agent_id);
        if (!record) {
          return textResult(`No agent with id "${params.agent_id}".`);
        }

        const snapshot = inspectActivity(
          record.session,
          params.since_cursor,
          params.max_events,
        );
        const lines = [
          `Agent "${record.description}" is ${record.status} (${record.turns} turns, ${record.toolUses} tool uses).`,
          `Activity cursor: ${snapshot.cursor}.`,
        ];
        if (snapshot.cursorReset) {
          lines.push(
            "The supplied cursor was stale; showing a recent snapshot.",
          );
        }
        if (snapshot.truncated) {
          lines.push("Earlier activity was omitted by the event limit.");
        }
        if (snapshot.events.length > 0) {
          lines.push("", ...snapshot.events);
        } else {
          lines.push("", "No settled activity since that cursor.");
        }
        if (snapshot.current) {
          lines.push("", `in progress: ${snapshot.current}`);
        }
        return textResult(lines.join("\n"));
      },
      renderResult: renderExpandableToolResult,
    }),
  );

  // ── steer_subagent ──────────────────────────────────────────────────────
  pi.registerTool(
    defineTool({
      name: SUBAGENT_TOOL_NAMES[3],
      label: "Steer subagent",
      description:
        "Inject a steering message into a running sub-agent to redirect it mid-run.",
      parameters: Type.Object({
        agent_id: Type.String({ description: "The running agent id." }),
        message: Type.String({ description: "Message to inject." }),
      }),
      execute: async (_id, params) => {
        if (!isEnabled()) return textResult(SUBAGENTS_DISABLED_MESSAGE);
        const result = await manager.send(
          params.agent_id,
          params.message,
          "steer",
        );
        switch (result.kind) {
          case "delivered":
            return textResult(`Steered agent ${params.agent_id}.`);
          case "queued":
            return textResult(
              `Agent ${params.agent_id} has not started a turn yet. Your message is queued and reaches it when it does.`,
            );
          case "rejected":
            return textResult(result.reason);
        }
      },
    }),
  );
}
