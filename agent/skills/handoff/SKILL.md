---
name: handoff
description: "Create a durable handoff document that captures current context, decisions, touched files, current state, and the next task, copied to the clipboard by default. Use when wrapping up work, pausing a thread, or preparing someone (or a future session) to continue."
disable-model-invocation: false
---

# Handoff

Use this skill when the user wants a durable written handoff.

The main output of this skill is a handoff document in Markdown.

## Output destination

By default, copy the handoff to the clipboard instead of creating a file: write it to a temp file and pipe it with `clippy` (`clippy < "$TMPDIR/handoff.md"`).

Write a file only when the user asks for one. Then choose the path in this order:

1. An explicit user-provided path.
2. `HANDOFF.md` at the git repo root, if the current working directory is inside a git repository.
3. Otherwise `HANDOFF.md` in the current working directory.

If a `HANDOFF.md` already exists at the target path, read it first so you can replace it intentionally instead of blindly overwriting stale context.

## What to include

Write a concise, self-contained handoff with these sections:

- `# Handoff`
- `## Context`
- `## Decisions`
- `## Files Involved`
- `## Current State`
- `## Next Task`
- `## Open Questions / Risks`
- `## Suggested Verification`

Use the template in `template.md`.

## Process

1. Use the current conversation as the primary source of truth.
2. If needed, inspect relevant files, plans, or git status to ground the handoff.
3. Prefer concrete bullets over long prose.
4. Preserve important decisions, constraints, caveats, and file paths exactly.
5. Make `## Next Task` actionable enough that a new session could start from it immediately.
6. Deliver the final result: copy to the clipboard by default, or write to the selected path if the user asked for a file.
7. Afterwards, give the user a short summary of what was captured and where it went (clipboard or file path).

## Tailoring

Treat any user-provided arguments as guidance for the handoff focus, such as:

- What should happen next
- What phase or area to emphasize
- What the receiving person/session should do first
