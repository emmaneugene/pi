---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior, blast-radius for what a change breaks elsewhere."
source: https://github.com/cursor/plugins/tree/main/pstack/skills/why
---

# Why

Investigate the motivation and constraints behind code. Use `how` for runtime behavior; use `why` for historical rationale, rejected alternatives, and the forces that shaped a decision.

## Operating contract

- Anchor the question in concrete files, symbols, commits, and pull requests before dispatching investigators.
- Search every available evidence category in parallel. A null result is evidence; an unsearched source is a gap.
- Separate cited facts from supported inference, speculation, and unknowns.
- Cite every claim about intent and surface conflicting sources instead of choosing the tidier story.
- Report unavailable sources and empty searches explicitly.
- Never infer motivation from code shape alone.

`references/epistemics.md` defines confidence levels and permitted phrasing. Investigator and synthesizer prompts apply that framework directly.

## Step 1. Understand the Target and the Question

Parse what the user is asking. The **target** is usually a chunk of code, a pattern, a feature, or a named design decision. The **question** is usually one of:

- "Why was X designed this way?" Design rationale.
- "Why do we do X instead of Y?" Tradeoff or alternatives.
- "What edge cases motivated this?" Defensive reasoning.
- "What business or product constraint led to this?" External forcing function.
- "Why does this code still exist?" Dead-code territory.
- "What's the history of X?" Broad archaeological sweep.

If the target is vague ("why do we do it this way?" with no clear referent), make your best guess from conversation context (open files, recent edits, cursor location, what was just discussed). State your interpretation briefly so the user can redirect if you're off, then proceed.

## Step 2. Establish the Code Anchor

Before spawning investigators, anchor the investigation in concrete code. You need:

- The relevant file path(s) and line range(s)
- The key symbols (function names, class names, constants)
- An initial commit list. The last few commits touching the target.
- PR numbers from merge commits (pattern `(#1234)` in the subject line)

Build this inline. It's cheap, and every investigator needs it.

```bash
# Blame target lines for last-touch commits
git blame -L <start>,<end> <file>

# Full file history, with patches, through renames
git log --follow -p -- <file>

# Last N commits touching the file, PR numbers visible
git log --oneline -20 -- <file>

# Extract PR numbers from a commit message
git log -1 --format=%B <commit>
```

Pull PR bodies and discussion via `gh` for any substantive commits:

```bash
gh pr view <number> --json title,body,author,createdAt,mergedAt,labels,closingIssuesReferences,comments,reviews
```

Capture this as seed context (file paths, symbols, commits, PR numbers, linked ticket IDs). Pass it to the investigators so they don't rediscover it.

## Step 3. Spawn Parallel Investigators (default posture)

**Default to the full parallel investigation.** Each evidence category lives in a different kind of system, and you cannot tell from the question alone which one holds the answer without looking. So look across every available category, in parallel, by default.

### Discovery

Before spawning investigators, list the available MCP servers with the `mcp` tool: `mcp({})` shows server status; `mcp({ server: "name" })` lists a server's tools when classification is unclear.

Map each available MCP to one evidence category:

1. Source control history
2. Issue / ticket tracker
3. Long-form documents
4. Real-time team chat
5. Infrastructure observability
6. Error / exception tracking
7. Product analytics warehouse

Source control is always available through git and `gh`. For the other six, classify using the MCP name, server instructions, tool names, and resource descriptors. If an MCP could fit more than one category, choose the one matching its primary evidence. Record ambiguous cases in the coverage map.

Aim for a complete **coverage map**, not a minimal one. A null result from an issue tracker is evidence the decision was not ticketed, a useful fact in itself. Document the null, don't skip the search.

Launch all matching investigators in a single message so they run concurrently. One investigator per category lets each specialize in one tool's query vocabulary and result shape. Don't ask one agent to cover multiple MCPs.

Subagent config (each):

- `subagent_type`: `general` (investigators need the `mcp` tool to query their evidence source)
- `model`: omit for the default, or set a configured fast model

Investigators must not write or mutate anything: read-only posture, not a sandbox.

Each investigator gets:

1. The base prompt from `references/investigator-prompt.md`
2. The category playbook `references/sources/<source>.md` for the selected MCP, adapted from the examples in `references/source-playbook.md`
3. The cross-cutting `references/sources/incident-postmortem.md` **if the target code looks defensive** (null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers)
4. The code anchor from Step 2 (file paths, symbols, commit hashes, PR numbers, ticket IDs)
5. The user's original question

### Investigator roster

Use one investigator per available category. Give it the matching source guide rather than reproducing that guide in the dispatch.

| Category            | Typical sources                              | Guide                                                |
| ------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Source control      | Git, GitHub pull requests, comments, tests   | `references/sources/code-archaeology.md`             |
| Issue tracker       | Jira, Linear, GitHub Issues                  | matching tracker guide                               |
| Long-form documents | Confluence, Notion, design docs, ADRs        | matching document guide                              |
| Team chat           | Slack, Teams, Discord                        | `references/sources/slack.md` or matching guide      |
| Infrastructure      | Datadog, Grafana, New Relic, logs and traces | `references/sources/datadog.md` or matching guide    |
| Error tracking      | Sentry, Rollbar, Bugsnag                     | `references/sources/sentry.md` or matching guide     |
| Product analytics   | Databricks, Snowflake, BigQuery, dbt         | `references/sources/databricks.md` or matching guide |

Always run the source-control investigator. The category guide defines what to search, what evidence that source can provide, and how to report a null result.

### When to skip an investigator

Only skip with an **explicit, written justification** that goes in the final "Sources Consulted" section. Two valid reasons:

- **No MCP is available for that category** in this environment. Flag this as a gap, not a choice. Example: "Real-time team chat skipped. No matching MCP available, so the conversational record was not searchable."
- **The source is provably irrelevant**, not just "probably irrelevant." A high bar. Example: "Error / exception tracking skipped. Target is a build-time script with no runtime code path." Not "probably not in error tracking, it's a feature not an error."

"It's pure feature code, error tracking won't have anything" is **not** sufficient, and neither is "I doubt long-form docs would have this." Run the search; let the null result speak. The cost of an investigator returning empty is one subagent. The cost of missing a design doc that actually exists is a wrong answer.

If your scope assessment suggests a single-commit trivial target where the PR description already contains the complete answer, you may answer inline **only after** confirming all seven available category searches would be redundant. Say so explicitly. This should be rare.

## Step 4. Synthesize

Spawn one synthesizer subagent:

- `subagent_type`: `general`
- `model`: omit for the default, or set your strongest configured model. The synthesizer's quality check spot-verifies citations, which can require `mcp` access.

The synthesizer gets:

1. The investigator findings, including any null results and any categories skipped with justification
2. The code anchor from Step 2 (file paths, symbols, commit hashes, PR numbers, ticket IDs)
3. The user's original question
4. The epistemics framework from `references/epistemics.md`
5. The synthesizer prompt template from `references/synthesizer-prompt.md`

Its job is the final output: a confidence-weighted, evidence-cited narrative with clearly separated "what we know" and "what we're inferring" sections, plus honest acknowledgment of gaps and null-result sources.

## Step 5. Present

Take the synthesizer's output and present it to the user. You may lightly edit for clarity or add context from the conversation, but **do not rewrite the confidence language**. The epistemic framing is the product. Dropping the hedges to sound more authoritative is the exact failure mode this skill exists to prevent.

## Output format

The synthesizer owns the detailed report schema in `references/synthesizer-prompt.md`. Preserve these sections when presenting its result:

1. **The question** and **the code in question**.
2. **What we found** with direct citations.
3. **What we can reasonably infer**, with the inference chain and calibrated language.
4. **Competing hypotheses** when the record supports more than one explanation.
5. **What we do not know**, including empty searches and unavailable sources.
6. **Sources consulted**, one line per category.
7. **Confidence summary**.

If the user plans to change the code, finish with Preserve / Change / Avoid / Risk constraints derived from the evidence. Do not rewrite the synthesizer's confidence language.

## Orchestration failures to avoid

- Skipping an available category because it seems unlikely to help.
- Combining multiple evidence categories in one investigator.
- Dispatching investigators without the code anchor and original question.
- Omitting null results or unavailable sources from synthesis.
- Rewriting the synthesizer's confidence language to sound more decisive.

## Reference Files

- `references/epistemics.md`. Confidence tiers and phrasing guide. The synthesizer must follow it.
- `references/investigator-prompt.md`. Base prompt template for investigator subagents.
- `references/source-playbook.md`. Index pointing at the category playbooks below.
- `references/sources/*.md`. One self-contained example playbook per category, plus cross-cutting `incident-postmortem.md`. Give an investigator the single file that matches its category and adapt it to the available MCP.
- `references/synthesizer-prompt.md`. Prompt template for the synthesizer subagent, including the output format.
