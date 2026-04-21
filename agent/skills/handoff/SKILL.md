---
name: handoff
description: "Create a durable HANDOFF.md for a repo or working directory that captures current context, decisions, touched files, current state, and the next task. Use when wrapping up work, pausing a thread, or preparing someone (or a future session) to continue."
---

# Handoff

Use this skill when the user wants a durable written handoff instead of just another chat response.

The main output of this skill is a `HANDOFF.md` file.

## Output location

Choose the output path in this order:

1. An explicit user-provided path, if they gave one.
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
6. Write the final result to the selected output path with the `write` tool.
7. After writing, give the user a short summary of what was captured and where the file was written.

## Tailoring

Treat any user-provided arguments as guidance for the handoff focus, such as:

- what should happen next
- what phase or area to emphasize
- what the receiving person/session should do first
