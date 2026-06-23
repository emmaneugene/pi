# Subagents

Spawns child `AgentSession`s from markdown agent definitions.

## Tools

- `subagent` — launch a child agent (foreground or background). `inherit_context` prepends a compact parent-conversation excerpt.
- `get_subagent_result` — check a background agent by id
- `steer_subagent` — inject a message into a running agent

## Commands

- `/subagents` — toggle subagents on/off. State is saved to `~/.pi/agent/subagents.json`; disabling aborts running children and removes the subagent tools from the active tool set.
- `/agents` — list this session's subagents (live + on disk), then **view transcript** (opens in `$EDITOR`) or **stop** a running one.

## Transcripts

Child sessions are pi-native JSONL files under
`<parentSessionDir>/subagents/<id>.jsonl`, linked by `parentSession`.
The subfolder keeps them out of `/resume`; use `/agents` or `pi --export <path>`.

## Static tool gating

Agent types are markdown files in the active project (`.pi/agents/<name>.md`) or global pi home (`~/.pi/agents/<name>.md`). Project files override global files. Frontmatter:

```yaml
tools: read, grep, find, ls # explicit allowlist (omit/"none" = zero tools)
model: haiku # fuzzy or provider/id
prompt_mode: replace # or append (inherit parent system prompt)
max_turns: 30
```

Enforced twice (see `child-session.ts`):

1. `createAgentSession({ tools })` gates built-in registration + initial active set.
2. post-`bindExtensions` re-filter removes every unlisted extension tool.

## Files

| file               | role                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `index.ts`         | composition root: wire registry, manager, tools, commands, notifications |
| `child-session.ts` | constructs and runs child sessions                                       |
| `manager.ts`       | spawn / abort / background concurrency queue                             |
| `registry.ts`      | global/project `.pi/agents/*.md` frontmatter loader                      |
| `config.ts`        | persisted on/off toggle                                                  |
| `gating.ts`        | explicit allowlist resolution                                            |
| `prompts.ts`       | system-prompt assembly (replace/append)                                  |
| `env.ts`           | git/platform detection for the prompt header                             |
| `transcript.ts`    | read JSONL transcripts + discover this session's children on disk        |
| `agents-menu.ts`   | the `/agents` interactive flow                                           |
| `types.ts`         | shared types                                                             |

## pi integration notes (`child-session.ts`)

1. explicit tool allowlist at `createAgentSession` — gates built-ins + active set
2. post-`bindExtensions` allowlist re-filter — strips every unlisted extension tool
3. suppress AGENTS.md re-append — loader `noContextFiles` + `appendSystemPromptOverride: () => []`
4. `loader.reload()` before `createSession`
5. graceful turn limits — soft steer, then hard abort after grace
6. result collection — stream `text_delta`, fall back to last assistant message
7. forward parent `AbortSignal` → child `session.abort()`
