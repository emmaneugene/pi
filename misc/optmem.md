# OptMem

Permanent, append-only memory for AI agents: https://github.com/VictorTaelin/OptMem

The `<memory>` block in `agent/SYSTEM.md` instructs agents to use OptMem, so the
installation below is required on every host that runs this Pi config. Without
it, every session fails its first tool call (`memo wake`).

## Installation

```sh
curl -fsSL https://raw.githubusercontent.com/VictorTaelin/OptMem/main/install.sh | sh
```

Installs a single self-contained Python script at `~/.optmem/memo`. Nothing else
is required; re-running the installer is safe.

## What it installs

- `~/.optmem/memo` — the whole implementation: one Python file, no deps
- `~/.optmem/memory/` — the data store, managed by the tool:
  - `LOG.txt` — raw memories, strictly append-only, one per line; `#N` ids are
    line indexes
  - `TREE/` — recursively compressed summary tree (pairs of entries, pairs of
    pairs, …), rebuilt by `nap`
  - `config` — size knobs; the defaults are fine

`MEMORY_DIR` relocates the store. One memory per machine, one identity forever.

## Command surface

- `memo wake` — startup read; agents must run this first, every session
- `memo note "<one line>"` — append one memory (max length from `config`)
- `memo nap [lo-hi "<line>"]` — perform pending tree compressions
- `memo recall <regex>` — word-for-word regex search over everything
- `memo zoom <lo>-<hi>` — open a tree node into its two halves
- `memo forget <lo>-<hi>` — drop a bad summary; `nap` recomputes it
- `memo config [NAME=N]` — show or edit size knobs
- `memo import <file>` — bulk-load dated memories (bootstrap only)

## Design notes

- Raw entries cannot be deleted or rewritten; `forget` only repairs summary
  nodes, and `nap` rebuilds them from the log. A wrong memory is corrected by
  appending a newer one, not by editing.
- `memo init` prints the system-prompt template in markdown; the version in
  `agent/SYSTEM.md` is the XML-tag conversion and is the source of truth here.
  Reconvert after pasting if `init` is ever re-run.
