# @onurpi/turn-fold

This extension vendors [`@onurpi/turn-fold`](https://github.com/osolmaz/onurpi/tree/4fd56fb5c91e3d555dfe329abfcdc8df2a761ee5/packages/turn-fold) at commit `4fd56fb5c91e3d555dfe329abfcdc8df2a761ee5`, retrieved 2026-07-29. Its Pi 0.84.3 compaction-replay fix is synced from upstream commit [`0c230a4`](https://github.com/osolmaz/onurpi/commit/0c230a488bcc9f1bdc3817652975a536de629769). The upstream repository does not declare a license, so this copy must remain private.

The vendored snapshot includes the runtime modules, behavior specification, transcript-window design, and Vitest suite. Local adaptations move tests into `test/`, use the repository's shared dependencies and test runner, and check the package through `agent/tsconfig.check.json`. Non-TUI sessions skip Turn Fold, and nested transcript components retain Pi's native rendering. The sibling `diff/` module owns change summaries, so the upstream edit diffstats are removed from this copy.

Compact transcript rendering for the Pi coding agent.

`@onurpi/turn-fold` keeps Pi's working line and the latest three activity rows visible during a
run. Earlier activity is replaced by one summary row directly below the user message. When the run
stops, that position holds the `Worked for …` line, using `s`, `m`, `h`, `d`, and `w` units as needed. All summary rows use the theme's warning color. User messages and every visible assistant message
show their local timestamp below the content in both compact and expanded modes. Turn Fold
keeps one padding line before the next user message instead of Pi's usual two. Tool rows and
intermediate assistant messages disappear, leaving the final response below the summary. Automatic
compactions during a turn appear as `compacted` in the summary instead of a separate transcript row.
Manual compactions performed while Pi is idle keep Pi's original row. Interrupted runs retain their last partial response or a fallback message.

The extension changes only the display. Pi keeps every stored session message, while compaction still
controls what reaches the model. The normative behavior is defined in [SPEC.md](SPEC.md).

## Modes

| Mode       | Behavior                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `compact`  | Shows a summary below the user message, followed by live or final activity.                           |
| `expanded` | Shows Pi's original rows within the loaded transcript range.                                       |

`compact` is the default.

## Use during development

From the repository root:

```bash
npm install
pi -e ./packages/turn-fold/index.ts
```

The package is private and is not published yet.

## Controls

```text
/turn-fold                  open the mode picker
/turn-fold compact          use the compact transcript
/turn-fold expanded         show the complete transcript
/turn-fold toggle           switch between compact and expanded
/turn-fold status           show the current mode and window value
/turn-fold windows 5        load exactly 5 compaction windows
/turn-fold windows +2       load 2 more windows
/turn-fold windows -1       unload 1 window
/turn-fold windows all      load the full active branch after confirmation
/turn-fold windows reset    return to the default of 3
```

`Ctrl+Shift+O` switches between compact and expanded rendering without adding a shortcut hint to
summary lines. `Ctrl+O` remains Pi's separate tool-output detail toggle.

## Transcript windows

Turn Fold loads three compaction windows into the main transcript by default. Changing the window
value waits for Pi to become idle, then rebuilds that transcript. The selected range begins with the user message that led
into its oldest compaction window and continues through the active leaf. `all` warns before replaying
the full branch because a large transcript can slow editor input.

Window selection changes only the TUI path. Pi's model context remains compacted. Turn Fold also
caches the component layout and its counts so unchanged redraws avoid rescanning or sorting turn
activity. See [TRANSCRIPT-WINDOWS.md](TRANSCRIPT-WINDOWS.md) for the design.

Mode and window changes are stored as custom session entries, so each session restores its latest
supported configuration. Automatic compaction associations live only in process memory and survive `/reload` without
writing to Pi's session. They use exact compaction and active-turn entry IDs and are limited to the
active branch. After a full Pi restart, earlier compactions remain standalone because Pi's stored
compaction entries do not identify their trigger. Historical turns are reconstructed from the active
session branch. Older `live` and `final-only` values are no longer modes and resolve to the compact
default.

## Current implementation boundary

Pi does not expose a public whole-turn renderer or transcript-range API. Turn Fold patches Pi's
built-in transcript component renderers and replaces the TUI-only `buildContextEntries()`
projection. It does not replace `buildSessionContext()`. Non-TUI sessions do not install render
patches or transcript adapters. Components in the `/subagents` transcript viewer inherit an explicit
foreign-transcript marker before their constructors run, so every patched method keeps Pi's native
rendering and does not enter parent turn state. The package targets Pi 0.80.10 or newer and must be
retested when Pi changes these interactive paths.

## Quality checks

Run the shared checks from `agent/`:

```bash
npm run typecheck
npm test   # from ~/.pi/agent
```

Upstream-only coverage, Slophammer, and mutation dependencies are not vendored.
