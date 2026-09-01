# Turn diff

Turn diff adds a compact transcript card after each completed Pi agent run. The card reports files changed through Pi's successful built-in `edit` and `write` tools, with total and per-file line counts.

```text
[last turn] Edited 7 files  +12 -3
  README.md  +2 -0
  src/a.ts  +3 -1
  src/b.ts  +1 -0
  src/c.ts  +4 -2
  /tmp/generated.txt  +2 -0
  ... 2 more
```

The card lists at most five files while its totals cover every changed file. Run `/turn-diff` to review the complete last-turn patch in Hunk.

## Review workflow

1. Run `/turn-diff`.
2. Navigate the complete targeted patch in Hunk.
3. Press `c` on a hunk to write a review annotation and `Ctrl+S` to save it.
4. Quit Hunk when the review is complete.
5. Turn diff inserts the saved annotations into Pi's editor as review feedback. Inspect or edit the feedback, then submit it normally.

The extension caches annotations while Hunk is open because Hunk exposes human notes only through its live-session API.

## Behavior

- A run starts at `before_agent_start` and finishes at `agent_settled`.
- Each target file is read before its first `edit` or `write` call.
- Only targets with at least one successful `edit` or `write` result are counted.
- Final content is compared with initial content to report net added and removed lines and construct a unified patch.
- Net-zero changes do not produce a card.
- Cards and patches are durable session entries and stay out of model context.
- Patches are limited to 1 MB. Larger turns retain file and line summaries but cannot open in Hunk.

The extension follows tool targets instead of scanning the workspace. It therefore works outside Git repositories and tracks absolute paths outside the current working directory.

## Limits

- Changes made by `bash`, custom tools, the user, or external processes are not discovered.
- If another process changes a tracked target during the run, its changes can affect that file's final line counts and patch.
- Git is required for line counting and patch generation through `git diff --no-index`, but the working directory does not need to be a Git repository.
- Hunk must be installed and available on `PATH` for `/turn-diff`.
- Built-in `edit` and `write` operate on text files; binary statistics are not supported.

## Try it

Load the extension for one Pi session:

```bash
pi --no-extensions -e /absolute/path/to/turn/index.ts
```

This module is mounted by the `turn` extension's composition root
(`../index.ts`); pi discovers extensions one level deep, so the `turn`
directory under `~/.pi/agent/extensions/` loads it automatically.

## Development

Run the dependency-free integration tests with the Node version used by Pi:

```bash
node --experimental-strip-types --test test/*.test.ts
```

Type-check from a Pi config checkout with dependencies installed:

```bash
npx tsc -p tsconfig.check.json
```
