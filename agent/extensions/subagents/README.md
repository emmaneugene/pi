# Subagents

Spawns child `AgentSession`s from markdown agent definitions.

## Sources and prior art

This extension was built from ideas studied in these repos:

- [`gotgenes/pi-packages/packages/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) — primary reference for the minimal-core shape: child `AgentSession` construction, manager/tool split, transcript persistence, turn limits, result collection, and the “subagent as recursive pi session” model.
- [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) — upstream lineage/reference for batteries-included subagent behavior, including denylist-style static gating ideas and the in-memory child-session pattern later replaced here with persisted transcripts.

This is not a fork of either repo. It keeps the small pi-integration tricks and rebuilds the extension around local markdown agents and a narrower UX.

## Tools

- `subagent` — launch a child agent asynchronously and return its id immediately. `inherit_context` prepends a compact parent-conversation excerpt. `model` and `thinking` override the agent definition per spawn; an unresolvable `model` is rejected with the closest available ids instead of silently falling back to the parent model. `wait: true` blocks the tool call until the child settles and returns its result inline; several wait spawns in one assistant message run in parallel (pi's agent loop) and their results return together, which makes an all-blocked wave a plain fan-out. A waited child sends no completion notification — the tool result is the delivery — and a parent interrupt aborts it like any other child.
- `get_subagent_result` — check an agent by id
- `inspect_subagent` — read a bounded, cursor-based snapshot of recent settled activity plus any in-progress assistant text; intended for informed steering, not completion polling
- `steer_subagent` — inject a message into a running agent

## Activity widget

While subagents are in flight, up to five rows render above the prompt editor:

```
● find call sites     · read src/router.ts                          1m12s
◌ audit the schema    · queued                                         3s
✗ check the migration · transient provider failure                    41s
… 2 more
ctrl+shift+a subagents
```

Each row is `icon · description · recap · elapsed`. The recap shows the active
tool, streaming text, or `thinking`. It does not use a model call.

The widget remains after the parent turn ends. Completed agents fade after a few
seconds. Failed, cancelled, and stopped agents stay until you open them.

`ctrl+shift+a` opens `/subagents`. Some terminals require the Kitty keyboard
protocol to distinguish this key from `ctrl+a`.

## Commands

- `/toggle-subagents` — toggle subagents on/off. State is saved to `subagents.json` in the pi agent config directory; disabling aborts running children and removes the subagent tools from the active tool set.
- `/subagents` — list this session's subagents (live + on disk) with status, effective model, thinking level, and setting source. **Enter** opens a full-screen transcript that streams live session events. Use arrow keys or Page Up/Page Down to scroll, End to resume auto-follow, the configured tool-expansion key to toggle tool details, and Escape to return. Use the configured external-editor key from the picker to open the rendered transcript in `$EDITOR` (builtin editor fallback).
- `/show-subagents` — read-only catalog of available subagent types and their config (context, tools, model, thinking, prompt mode).

The `subagent` tool row also shows the selected type, effective model, effective thinking level, and whether each setting came from a tool override, the agent definition, or inherited defaults. `/subagents` rows include completed agent-turn counts; counts for running agents refresh live while the picker is open.

Completion notifications show one line by default. Use the configured tool-expansion key (Ctrl+O by default) to show the full result.

A child belongs to the parent session that spawned it. Switching parent sessions aborts and forgets all live children before the new session starts.

## Steering from the viewer

Inside a subagent's transcript:

| key                               | action                                                    |
| --------------------------------- | --------------------------------------------------------- |
| `Enter`                           | open the composer; `Enter` again sends                    |
| `app.message.followUp`            | send as a follow-up instead of a steer                    |
| `Esc`                             | close the composer, or leave the viewer when it is closed |
| `ctrl+x`                          | stop this subagent                                        |
| `[` / `]`                         | previous / next subagent in the list, wrapping            |
| `↑` `↓`                           | one line                                                  |
| `ctrl+u` / `ctrl+d`               | half page                                                 |
| PgUp / PgDn (Ctrl+ in fullscreen) | one page                                                  |
| `Home` / `End`                    | top, or bottom to resume following                        |

Scrolling to the bottom resumes live follow mode.

The viewer uses keyboard scrolling. Extension containers cannot lay out pi's
`ScrollView`, and pi consumes wheel events before extension listeners.

## Transcripts

Child sessions are pi-native JSONL files under `<parentSessionDir>/subagents/<parentSessionId>/<id>.jsonl`, linked by `parentSession`. Each new transcript includes a `subagent-invocation` custom entry with the exact invocation metadata. The catalog infers model, thinking, and type where possible for older transcripts.

The subfolder keeps child sessions out of `/resume`; use `/subagents` or `pi --export <path>`.

## Tool gating

Agent types are markdown files in the active project's config agents directory (`<config-dir>/agents/<name>.md`) or the global pi agents directory (`<pi-home>/agents/<name>.md`). Project files override global files. Frontmatter:

```yaml
tools: read, grep, find, ls # allowlist; omit or "all" = every tool, "none" = nothing
model: haiku # fuzzy or provider/id
thinking: high # minimal|low|medium|high|xhigh|max, clamped per model
prompt_mode: replace # or append (inherit parent system prompt)
max_turns: 30
```

A definition naming an unavailable model falls back to the parent model, and the
invocation then reports `inherited/default` rather than claiming the definition
applied.

Omitting `tools:` grants every tool. An allowlist limits the model's available
tool schemas, but it is not an OS sandbox. For example, `bash` can still edit
files.

The denylist always applies:

| tool                                                                    | reason                                 |
| ----------------------------------------------------------------------- | -------------------------------------- |
| `subagent`, `get_subagent_result`, `inspect_subagent`, `steer_subagent` | Recursive subagents are not supported. |
| `AskUserQuestion`                                                       | Child sessions have no UI context.     |

`child-session.ts` applies both rules before and after extension tools register.

## Files

| file                   | role                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `index.ts`             | composition root: wire registry, manager, tools, commands, notifications |
| `child-session.ts`     | constructs and runs child sessions                                       |
| `manager.ts`           | spawn / abort / asynchronous concurrency queue                           |
| `native-transcript.ts` | pi-native transcript components for the session viewer                   |
| `widget.ts`            | activity rows above the editor: selection, lines, ticking component      |
| `recap.ts`             | one-line "what is it doing", derived from the live record                |
| `notification.ts`      | collapsed and expanded completion-notification renderer                  |
| `registry.ts`          | global/project agent markdown frontmatter loader                         |
| `models.ts`            | model-reference lookup and rejection suggestions                         |
| `config.ts`            | persisted on/off toggle                                                  |
| `gating.ts`            | the tool allowlist and the always-on denylist                            |
| `prompts.ts`           | system-prompt assembly (replace/append)                                  |
| `env.ts`               | git/platform detection for the prompt header                             |
| `transcript.ts`        | read JSONL transcripts + discover this session's children on disk        |
| `agents-menu.ts`       | the `/subagents` session-history catalog flow                            |
| `types.ts`             | shared types                                                             |
