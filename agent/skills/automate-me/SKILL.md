---
name: automate-me
description: Update the existing global man-mode skill from durable preferences found in Pi sessions and direct user feedback. Use only through /skill:automate-me or an explicit request to refresh man-mode.
source: https://github.com/cursor/plugins/tree/main/pstack/skills/automate-me
compatibility: Requires Pi session search tools and the global man-mode skill.
disable-model-invocation: true
---

# Automate me

Update the root-level `man-mode` skill (`agent/skills/man-mode/SKILL.md`). Never create, rename, or target another mode skill.

## 1. Read the current instruction hierarchy

Read these before mining sessions:

- The active root-level system prompt (`agent/SYSTEM.md`)
- The root-level `man-mode` skill (`agent/skills/man-mode/SKILL.md`)
- Skills that `man-mode` references or overlaps

Treat `man-mode` as a lean delta over the active system prompt. Do not copy writing, coding, safety, delegation, permission, or tool guidance that already has an authoritative owner.

## 2. Mine recent Pi sessions

Use `search_sessions` to find explicit preferences, corrections, repeated workflow choices, and meta-feedback. Use `read_session` only around promising hits.

By default, search the last 30 days across the user's Pi sessions because `man-mode` is global. Narrow the window or workspace when the user requests it. Do not expose private transcript paths, credentials, customer data, or project details in the skill.

Look for evidence about:

- Autonomy and when to ask
- Investigation and verification standards
- Context and instruction design
- Delegation and model use not already in the system prompt
- Repeated process choices
- Skill and automation preferences
- Corrections that reveal a general rule

Separate the user's own preferences from team-authored files, pasted instructions, repository conventions, and agent-chosen behavior. Those are not personal evidence unless the user explicitly adopts them.

## 3. Judge the evidence

Classify each candidate:

- **Strong**: explicit preference, direct workflow correction, or the same pattern in at least two independent sessions
- **Medium**: repeated accepted behavior without explicit endorsement
- **Weak**: one ambiguous event, agent-selected behavior, or task-specific direction
- **Contradicted**: credible evidence points in different directions

Propose only strong candidates. Use medium evidence to ask a focused question. Drop weak evidence. Present contradictions instead of resolving them silently.

Compare every candidate with the active system prompt and existing skills. Reject duplicates even when the evidence is strong.

## 4. Present the proposed update

Before editing, show:

- Evidence window and scope
- Preferences to add, revise, or remove
- Existing rules that have proven stable across the evidence window, proposed for promotion into the system prompt and removal from man-mode; man-mode is a staging area, not a second permanent prompt
- Candidates rejected as duplicates or weak evidence
- Contradictions or questions that block an accurate edit

Keep evidence references concise. Describe the relevant interaction and date; do not expose transcript storage paths.

Wait for explicit approval of the proposed changes. Approval to run this skill is not approval of an unseen edit.

## 5. Edit only man-mode

After approval, edit the root-level `man-mode` skill (`agent/skills/man-mode/SKILL.md`) in place:

- Preserve rules not contradicted by stronger evidence
- Revise stale rules instead of layering exceptions
- Remove rules now owned by the system prompt or another skill
- Add a section only for a distinct, actionable preference
- Reference other skills instead of inlining their workflows
- Keep the frontmatter user-invocable with `disable-model-invocation: true`

Load `writing-guidelines` for the edit. Keep every instruction operational and concise.

## 6. Validate and report

Read the finished skill, run Pi's skill validation through a clean startup, and report:

- Rules added, revised, or removed
- Evidence basis for each change
- Candidates deliberately not encoded
- Any validation limitation

Do not commit or push unless the user separately requests it.

## Guardrails

- Never update another skill or repository files
- Never update the active system prompt except to apply an explicitly approved promotion
- Never infer a permanent preference from one situational request
- Never make `man-mode` automatic
- Never preserve duplication for portability; this mode belongs to this Pi harness
- Prefer no edit when the evidence does not justify one

Adapted for Pi and a fixed `man-mode` target from pstack's `automate-me` skill.
