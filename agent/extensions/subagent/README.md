# Subagent extension

Delegates work to specialized subagents by spawning separate `pi` subprocesses with isolated context.

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
---

System prompt here.
```

This repo keeps project-local agents in:

- `agent/agents/*.md`

The extension discovers them from the nearest `.pi/agents` directory when `agentScope` is set to `"project"` or `"both"`.

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
