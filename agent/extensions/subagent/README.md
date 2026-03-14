# Subagent extension

Delegates work to specialized subagents by spawning separate `pi` subprocesses with isolated context.

The `subagent` tool is disabled by default and becomes available only when subagent mode is enabled.

## Files

- `agent/extensions/subagent/index.ts` — extension entrypoint
- `agent/extensions/subagent/agents.ts` — agent discovery logic
- `agent/agents/*.md` — agent definitions used by the tool

## How it works

The `subagent` tool launches a fresh `pi` process per task, optionally with:

- a different model
- a restricted tool set
- a dedicated system prompt
- a task-specific working directory

Supported modes:

- single: one agent, one task
- parallel: multiple agents concurrently
- chain: sequential handoff using `{previous}`

## Agent definitions

Agents are markdown files with frontmatter, for example:

```md
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-sonnet-4-5
thinking: minimal
---

System prompt here.
```

Supported frontmatter fields:

- `name`
- `description`
- `tools`
- `model`
- `thinking` — `off`, `minimal`, `low`, `medium`, `high`, `xhigh`

The extension passes `thinking` through as `--thinking <level>` when launching the child `pi` process.

This repo keeps project-local agents in:

- `agent/agents/*.md`

The extension discovers them from the nearest `.pi/agents` directory when `agentScope` is set to `"project"` or `"both"`.

## Mode toggle

- `/subagents` — toggle subagent mode on/off
- `--subagents` — start the session with subagent mode enabled

When enabled, the extension adds the `subagent` tool to the active tool list and shows a small status indicator.
When disabled, the tool is removed from the active tool list.

## Usage ideas

Single:

```text
Use the subagent tool with agent "scout" to find all auth-related code.
```

Chain:

```text
Use the subagent tool as a chain: scout the login flow, then planner creates an implementation plan using {previous}.
```

Parallel:

```text
Use the subagent tool to run two scouts in parallel: one for API routes, one for database models.
```

## Notes

- Project-local agents are repo-controlled prompts; only enable them in trusted repos.
- After adding or editing the extension/agents, run `/reload` in pi.
