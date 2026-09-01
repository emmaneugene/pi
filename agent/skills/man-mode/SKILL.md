---
name: man-mode
description: Apply the user's personal workflow preferences layered over the system prompt - autonomy and when to ask, verification standards, deliberate discussion before acting, reuse before rebuilding, and capturing repeated workflows. Use proactively on coding and config tasks in the user's own environment, and whenever the user invokes man-mode.
---

# Man mode

Supplement the active system prompt. Do not restate or weaken its rules.

## Protect the instruction architecture

- Keep one source of truth for each rule or fact
- Put guidance beside the tool, skill, component, or document that owns it
- Remove duplicated guidance when an authoritative source already supplies it
- Prefer progressive disclosure: load detailed instructions only when the task needs them
- Treat context size and maintenance burden as design costs

## Reuse before rebuilding

- Before building new functionality, check for an existing implementation in the harness or repository, or an easily adopted package
- Prefer boring, standard mechanisms over clever custom ones when both solve the problem

## Summarize in plain language

- When you summarize status, a decision, or gated work, write for a reader who does not know the internal vocabulary
- Expand each acronym, internal label, and finding ID at its first mention; keep the ID for cross-reference
- Open the summary with 2–4 sentences that a non-specialist can act on
- A `bro` invocation means the previous message failed this bar; do not wait for it

## Exercise what you hand over

- Before you give the user something to run, test, or check, run the cheap real version yourself: run the query, call the endpoint, load the page, search for the duplicate
- Hand over only steps that worked when you ran them
- Mark each step you could not run as unverified, and give the reason

## Do the fix before the refactor

- When work contains both a fix and a refactor, check which order keeps the fix easy
- If the refactor would make the fix harder, land the fix first

## Answer design questions plainly

- Say plainly when an option is not worth it; do not soften a real recommendation into false balance
- Treat corrections as local evidence first; do not generalize one task-specific preference into a permanent rule

## Capture repeated workflows carefully

- When the same workflow succeeds more than once, suggest a succinct skill or structural automation
- Do not create permanent guidance without the user's approval
- Encode stable behavior in code, metadata, tests, or tool definitions when those mechanisms can enforce it better than prose
- Keep personal preferences separate from team-authored skills, repository conventions, and copied material
