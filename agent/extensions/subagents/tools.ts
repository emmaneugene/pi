/**
 * tools.ts — The LLM-callable tools: subagent, get_subagent_result,
 * steer_subagent. Thin dispatch over the manager.
 */

import { dirname, join } from "node:path";
import {
  defineTool,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveModel } from "./child-session.ts";
import type { SubagentManager } from "./manager.ts";
import type { AgentRegistry } from "./registry.ts";
import type { SubagentType } from "./types.ts";

export const SUBAGENT_TOOL_NAMES = [
  "subagent",
  "get_subagent_result",
  "steer_subagent",
] as const;

const DISABLED_MESSAGE =
  "Subagents are disabled. Run /subagents to enable them.";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** Format a background-completion / status line for the orchestrator. */
function describe(r: {
  description: string;
  status: string;
  toolUses: number;
  result?: string;
  error?: string;
  transcriptFile?: string;
}): string {
  const head = `Agent "${r.description}" ${r.status} (${r.toolUses} tool uses).`;
  const transcript = r.transcriptFile
    ? `\n\nTranscript: ${r.transcriptFile}`
    : "";
  if (r.error) return `${head}\nError: ${r.error}${transcript}`;
  return `${head}\n\n${r.result ?? "No output."}${transcript}`;
}

export function registerTools(
  pi: import("@earendil-works/pi-coding-agent").ExtensionAPI,
  manager: SubagentManager,
  registry: AgentRegistry,
  isEnabled: () => boolean,
): void {
  const types = () => registry.availableTypes().join(", ");
  const globalAgentsDir = join(dirname(getAgentDir()), "agents");

  // ── subagent ────────────────────────────────────────────────────────────
  pi.registerTool(
    defineTool({
      name: SUBAGENT_TOOL_NAMES[0],
      label: "Subagent",
      description:
        `Launch a sub-agent for a multi-step task. Each runs in a fresh session with its own tool scope and system prompt. It has NOT seen this conversation, so the prompt must be self-contained.\n\n` +
        `Available types: ${types()}. Custom agents live in .pi/agents/<name>.md (project) or ${globalAgentsDir}/<name>.md (global).\n\n` +
        `- description: 3-5 words, shown in the UI.\n` +
        `- run_in_background: returns an id immediately; you are notified on completion (never poll).\n` +
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
              'Model override ("provider/id" or fuzzy e.g. "haiku").',
          }),
        ),
        max_turns: Type.Optional(
          Type.Number({
            description: "Max agentic turns. Omit for unlimited.",
            minimum: 1,
          }),
        ),
        run_in_background: Type.Optional(
          Type.Boolean({
            description: "Run in background; returns an id immediately.",
          }),
        ),
        inherit_context: Type.Optional(
          Type.Boolean({
            description:
              "Prepend a compact recent excerpt from the parent conversation (default false).",
          }),
        ),
      }),
      execute: async (
        _id,
        params,
        signal,
        _onUpdate,
        ctx: ExtensionContext,
      ) => {
        if (!isEnabled()) return textResult(DISABLED_MESSAGE);
        registry.reload(ctx.cwd);
        const type = params.subagent_type as SubagentType;
        if (!registry.isAvailable(type)) {
          return textResult(
            `Unknown or disabled subagent type "${params.subagent_type}". Available types: ${types()}.`,
          );
        }
        const model = params.model
          ? resolveModel(params.model, ctx.modelRegistry, ctx.model)
          : undefined;

        if (params.run_in_background) {
          const id = manager.spawn(pi, ctx, type, params.prompt, {
            description: params.description,
            model,
            maxTurns: params.max_turns,
            inheritContext: params.inherit_context,
            isBackground: true,
            signal: ctx.signal,
          });
          return textResult(
            `Launched background agent "${params.description}" (id: ${id}). You will be notified on completion.`,
          );
        }

        const record = await manager.spawnAndWait(
          pi,
          ctx,
          type,
          params.prompt,
          {
            description: params.description,
            model,
            maxTurns: params.max_turns,
            inheritContext: params.inherit_context,
            signal: signal ?? ctx.signal,
          },
        );
        return textResult(
          record.result?.trim() || record.error?.trim() || "No output.",
        );
      },
    }),
  );

  // ── get_subagent_result ─────────────────────────────────────────────────
  pi.registerTool(
    defineTool({
      name: SUBAGENT_TOOL_NAMES[1],
      label: "Get subagent result",
      description: "Check the status/result of a background sub-agent by id.",
      parameters: Type.Object({
        agent_id: Type.String({ description: "The agent id." }),
      }),
      execute: async (_id, params) => {
        if (!isEnabled()) return textResult(DISABLED_MESSAGE);
        const r = manager.getRecord(params.agent_id);
        if (!r) return textResult(`No agent with id "${params.agent_id}".`);
        if (r.status === "running" || r.status === "queued") {
          return textResult(
            `Agent "${r.description}" is ${r.status} (${r.toolUses} tool uses so far).`,
          );
        }
        return textResult(describe(r));
      },
    }),
  );

  // ── steer_subagent ──────────────────────────────────────────────────────
  pi.registerTool(
    defineTool({
      name: SUBAGENT_TOOL_NAMES[2],
      label: "Steer subagent",
      description:
        "Inject a steering message into a running sub-agent to redirect it mid-run.",
      parameters: Type.Object({
        agent_id: Type.String({ description: "The running agent id." }),
        message: Type.String({ description: "Message to inject." }),
      }),
      execute: async (_id, params) => {
        if (!isEnabled()) return textResult(DISABLED_MESSAGE);
        const ok = await manager.steer(params.agent_id, params.message);
        return textResult(
          ok
            ? `Steered agent ${params.agent_id}.`
            : `Could not steer ${params.agent_id} (not running?).`,
        );
      },
    }),
  );
}
