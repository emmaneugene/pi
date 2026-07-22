# Turn diff

Turn diff records one Git patch for each completed Pi agent run. It captures the workspace before Pi starts and after all model calls, tool calls, retries, and queued continuations settle. The result appears as a durable transcript card and stays out of model context.

## What it records

The extension snapshots the whole containing Git repository through an isolated temporary index. It does not change your working tree, staging area, commits, branches, or refs.

Each card includes:

- Changed file paths and rename information
- Added and removed line counts
- Binary-file markers
- The unified patch, visible when transcript details are expanded

Run `/turn-diff` to open the newest recorded patch on the active session branch in Hunk. Run `/turn-diff summary` for its file and line counts.

## Why it uses agent-run boundaries

Pi's `turn_start` and `turn_end` events describe one assistant response and its tool results. A single user request can produce several Pi turns. This extension starts at `before_agent_start` and finishes at `agent_settled`, which matches the user-visible unit that Codex calls a turn.

## Capture behavior

The snapshot includes:

- Tracked file contents
- Non-ignored untracked files
- File deletions, executable-bit changes, symlinks, and renames
- Changes made through `edit`, `write`, shell commands, or external processes

The baseline includes any dirty files that already exist when the run starts. The displayed patch therefore contains only the net change during the run.

The extension stores at most 1 MB of patch text in the session. Larger changes retain file and line summaries, with an explicit truncation message.

## Limits

- Git repositories only
- Ignored untracked files are excluded
- Dirty content inside submodules is not inspected recursively
- Files outside the repository root are excluded
- Concurrent external edits are attributed to the active agent run
- Staging-only changes are not represented because snapshots compare file content
- `/turn-diff` requires the `hunk` executable on `PATH`
- Undo and reapply are not implemented

Undo needs stronger safety than `git apply -R`. A later version should verify that the current content tree still matches the recorded final tree before changing files.

## Try it

Load the extension for one Pi session:

```bash
pi --no-extensions -e /absolute/path/to/turn-diff/index.ts
```

To load it automatically, place the `turn-diff` directory under `~/.pi/agent/extensions/`.

## Development

Run the dependency-free integration tests with the Node version used by Pi:

```bash
node --experimental-strip-types --test test/*.test.ts
```

Type-check from a Pi config checkout with dependencies installed:

```bash
npx tsc -p tsconfig.check.json
```
