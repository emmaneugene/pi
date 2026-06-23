/**
 * prompts.ts — System prompt assembly.
 *
 * Two modes:
 *   replace — env header + the agent's own instructions (full control).
 *   append  — parent system prompt verbatim FIRST (so the child shares an
 *             identical, cacheable byte-prefix with the parent — KV-cache
 *             reuse), then a sub-agent bridge, env header, instructions.
 *
 * Both carry an <active_agent name="..."/> tag so other extensions can resolve
 * per-agent policy by parsing the child's system prompt if they ever want to.
 */

import type { EnvInfo } from "./env.ts";
import type { AgentConfig } from "./types.ts";

const GENERIC_BASE = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;

const SUB_AGENT_BRIDGE = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Be concise but complete
</sub_agent_context>`;

export function buildAgentPrompt(
  config: AgentConfig,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
): string {
  const activeTag = `<active_agent name="${config.name}"/>\n\n`;

  const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

  const instructions = config.systemPrompt?.trim();

  if (config.promptMode === "append") {
    const identity = parentSystemPrompt || GENERIC_BASE;
    const custom = instructions
      ? `\n\n<agent_instructions>\n${instructions}\n</agent_instructions>`
      : "";
    // Parent prompt verbatim first → identical cacheable prefix across spawns.
    return (
      identity +
      "\n\n" +
      SUB_AGENT_BRIDGE +
      "\n\n" +
      activeTag +
      envBlock +
      custom
    );
  }

  // replace mode
  const header = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task.

${envBlock}`;
  return activeTag + header + (instructions ? "\n\n" + instructions : "");
}
