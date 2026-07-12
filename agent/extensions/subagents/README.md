# Subagents

Spawns child `AgentSession`s from markdown agent definitions.

## Sources and prior art

This extension was built from ideas studied in these repos:

- [`gotgenes/pi-packages/packages/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) — primary reference for the minimal-core shape: child `AgentSession` construction, manager/tool split, transcript persistence, turn limits, result collection, and the “subagent as recursive pi session” model.
- [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) — upstream lineage/reference for batteries-included subagent behavior, including denylist-style static gating ideas and the in-memory child-session pattern later replaced here with persisted transcripts.

This is not a fork of either repo. It keeps the small pi-integration tricks and rebuilds the extension around local markdown agents and a narrower UX.

## Tools

- `subagent` — launch a child agent (foreground or background). `inherit_context` prepends a compact parent-conversation excerpt.
- `get_subagent_result` — check a background agent by id
- `steer_subagent` — inject a message into a running agent

## Commands

- `/toggle-subagents` — toggle subagents on/off. State is saved to `subagents.json` in the pi agent config directory; disabling aborts running children and removes the subagent tools from the active tool set.
- `/subagents` — list this session's subagents (live + on disk) with status, effective model, thinking level, and setting source. **Enter** opens a read-only, full-screen transcript that streams live session events. Use arrow keys or Page Up/Page Down to scroll, End to resume auto-follow, the configured tool-expansion key to toggle tool details, and Escape to return. Use the configured external-editor key from the picker to open the rendered transcript in `$EDITOR` (builtin editor fallback).
- `/show-subagents` — read-only catalog of available subagent types and their config (context, tools, model, thinking, prompt mode).

The `subagent` tool row also shows the selected type, effective model, effective thinking level, and whether each setting came from a tool override, the agent definition, or inherited defaults. `/subagents` rows include completed agent-turn counts; counts for running agents refresh live while the picker is open.

## Transcripts

Child sessions are pi-native JSONL files under `<parentSessionDir>/subagents/<parentSessionId>/<id>.jsonl`, linked by `parentSession`. Each new transcript includes a `subagent-invocation` custom entry with the exact invocation metadata. The catalog infers model, thinking, and type where possible for older transcripts.

The subfolder keeps child sessions out of `/resume`; use `/subagents` or `pi --export <path>`.

## Static tool gating

Agent types are markdown files in the active project's config agents directory (`<config-dir>/agents/<name>.md`) or the global pi agents directory (`<pi-home>/agents/<name>.md`). Project files override global files. Frontmatter:

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
| `registry.ts`      | global/project agent markdown frontmatter loader                         |
| `config.ts`        | persisted on/off toggle                                                  |
| `gating.ts`        | explicit allowlist resolution                                            |
| `prompts.ts`       | system-prompt assembly (replace/append)                                  |
| `env.ts`           | git/platform detection for the prompt header                             |
| `transcript.ts`    | read JSONL transcripts + discover this session's children on disk        |
| `agents-menu.ts`   | the `/subagents` session-history catalog flow                            |
| `types.ts`         | shared types                                                             |

## pi integration notes (`child-session.ts`)

1. explicit tool allowlist at `createAgentSession` — gates built-ins + active set
2. post-`bindExtensions` allowlist re-filter — strips every unlisted extension tool
3. suppress AGENTS.md re-append — loader `noContextFiles` + `appendSystemPromptOverride: () => []`
4. `loader.reload()` before `createSession`
5. graceful turn limits — soft steer, then hard abort after grace
6. result collection — stream `text_delta`, fall back to last assistant message
7. forward parent `AbortSignal` → child `session.abort()`
