---
name: show-me-your-work
description: Keep a reviewable TSV decision trail for long-running, multi-phase, or unattended work. Use only through /skill:show-me-your-work or an explicit request for a decision or audit trail.
source: https://github.com/cursor/plugins/tree/main/pstack/skills/show-me-your-work
compatibility: Requires Pi file tools; final review uses the Pi subagent tool when available.
disable-model-invocation: true
---

# Show me your work

Keep one canonical decision trail so the user can reconstruct material choices, evidence, and outcomes without reading the full session.

Use this only when the review value justifies the overhead. Ordinary focused changes do not need a trail.

## Create the log

Default to `$PWD/tmp/decision-trails/<task-slug>.tsv`, where the user can inspect the artifact without adding it to the change set. Use another location only when the user requests it.

Initialize a log from `references/decision-log-template.tsv`, or let the helper create it on the first row:

```bash
~/.pi/agent/skills/show-me-your-work/scripts/log.sh \
  "$PWD/tmp/decision-trails/<task-slug>.tsv" \
  "<phase>" "<decision>" "<why>" "<evidence>" "<result>"
```

The columns are:

- **ts**: Coordinated Universal Time timestamp
- **phase**: phase or workstream
- **decision**: choice or completed checkpoint, in one line
- **why**: concrete reason for the choice
- **evidence**: resolvable commit, file and line, test output, trace, screenshot, or artifact path
- **result**: observed outcome such as `tests green`, `reverted`, `INCONCLUSIVE`, or `open`

The helper strips tabs and newlines and protects spreadsheet readers from formula injection.

## Log decisions, not activity

Append one row for each material event:

- A design or implementation fork
- A verified unit of work
- A pivot, failed attempt, or reversion
- A blocker or risk that changes the plan
- A gate fixed or left inconclusive

Skip file reads, routine commands, and self-evident steps. Evidence is a pointer, not a paragraph.

Keep the log append-only during the run. Correct a wrong row with a later row that names the correction; do not silently rewrite history.

The parent agent owns the canonical log. Delegated agents return findings and evidence to the parent instead of writing concurrently.

## Keep the trail local by default

Do not stage or commit the log without explicit permission. A committed trail is appropriate only when a reviewer needs it to trust a large migration, prolonged autonomous run, or similarly difficult change.

Do not record credentials, customer data, private prompts, or sensitive artifact contents. Point to safe evidence or mark the result unproven.

## Audit before handoff

Before reporting completion:

1. Compare each row with this conversation and the actual tool results
2. Resolve every evidence pointer and confirm it supports the row
3. Add missing forks, abandoned approaches, and corrections that shaped the outcome
4. Add a correction row for any false or overstated entry
5. Remove no history and add no aspirational work
6. Confirm the final result distinguishes verified, failed, open, and inconclusive claims

If compaction or delegation removed necessary context, use `search_sessions` and `read_session` narrowly to recover the relevant current-session evidence. Do not search unrelated workspaces.

## Run one independent review

Use one bounded review subagent on a different model provider when practical. Give it the log, relevant diff, and evidence paths. Ask it to identify:

- Decisions with weak or missing evidence
- Verification claims unsupported by the artifacts
- Premature, risky, or scope-expanding choices
- Important gaps a casual review could miss

Verify the reviewer's factual claims before reporting them. If no suitable reviewer is available, state that limitation rather than substituting self-review.

## Report

End the final response with:

```text
Decision trail: <path>

Attention
Reviewed by <model>
- <verified concern with row or evidence pointer>
```

Use `- No flags` when the independent review finds none. Name skipped or inconclusive review when applicable.

## Composition

Other skills should reference `show-me-your-work` instead of defining another decision-log format.

Adapted for Pi from pstack's `show-me-your-work` skill.
