---
name: codify
description: Find the authoritative home for supplied information. Check for contradictions, then propose how to document, enforce, or retain it. Use only when the user invokes this skill or explicitly asks to codify information.
disable-model-invocation: true
---

# Codify

Turn supplied information into a focused proposal for its authoritative home. Apply approved changes through the existing tools and workflows. Do not maintain a separate store of rules in this skill.

Missing from the current context does not mean missing from the source. Finding and loading an existing source can complete the task.

## 1. Understand the information

Identify:

- **Meaning:** Does it describe current behavior, prescribe required behavior, express a preference, or explain a decision?
- **Scope:** Who or what does it apply to: a component, project, person, or all work?
- **Strictness:** Is it mandatory, advisory, or an observation?
- **Verifiability:** Can a machine check it reliably, or does it require human judgment?
- **Lifetime:** Is it temporary, conditional, or expected to remain useful?

Use the supplied context and available evidence first. Ask when an unresolved distinction would change the destination or the proposed action. If no information was supplied, ask what the user wants to codify.

## 2. Find the existing owner

Inspect the likely sources before proposing a new one. Check relevant code, configuration, tests, documentation, instructions, and memory. Use session history when earlier decisions or repeated preferences matter. Keep the search proportional to the input.

Find the maintained source, not a generated copy. Check whether the intended reader or workflow can actually discover it. Distinguish absent knowledge from a failure to load or follow existing guidance.

Preserve the source, scope, conditions, and uncertainty of claims. Do not present user-reported behavior as independently verified. Do not promote a repeated project preference into a global rule merely because it recurs.

## 3. Check consistency before changing anything

Compare the supplied information with relevant sources. Check whether apparent contradictions concern the same scope, environment, version, and conditions. An explicit exception can explain a difference.

For an explicit replacement, propose an in-place update and identify affected guidance or checks. Escalate unresolved disagreements, not the existence of the rule being replaced.

For an unresolved contradiction:

- Pause changes that depend on resolving it.
- Show the conflicting claims and their sources.
- Explain the possible consequence and any evidence of a larger problem.
- Escalate to the user for a decision, or propose a handoff to the appropriate owner.

Do not silently choose a winner, reconcile the wording, or record a disputed claim as settled knowledge. Do not expand into a broad audit without approval.

## 4. Choose the narrowest useful home

Prefer an existing owner that reaches the intended audience. Use these destinations as guidance, not a lookup table:

| Information                                         | Likely home                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mandatory, machine-checkable constraint             | Existing code, types, configuration, validators, or lint rules; tests check the intended behavior |
| Local behavior, contract, or rationale              | Documentation or comments beside the owning component                                             |
| Project-wide agent behavior                         | Existing project instructions                                                                     |
| Tool-specific guidance or a repeatable procedure    | Tool description or the relevant skill                                                            |
| Concise behavior that should apply across projects  | Global system prompt                                                                              |
| Personal context, observations, or decision history | OptMem, under its existing memory rules                                                           |
| Temporary context                                   | Current conversation or an existing task/handoff artifact                                         |

Keep one authoritative owner for each rule. Supporting tests, rationale, and references can complement it without becoming competing definitions. Memory can record a decision and point to its owner instead of duplicating standing instructions.

If you cannot update the authoritative owner, propose a handoff or reference to it. Do not create a competing local rule.

Prefer existing enforcement mechanisms. A local hook can provide fast feedback, but shared enforcement may also need an existing continuous integration check. Consider exceptions, compatibility, and enforcement cost before proposing a new check.

For supplied secrets, decline to store the value or repeat it in proposals. Point to an established secret-management mechanism, if one exists.

## 5. Propose, then apply within approval

Give a concise proposal:

- **Meaning and scope:** What you understood.
- **Owner and evidence:** Where it belongs, what already exists, and any uncertainty.
- **Action:** The smallest useful change, its reason, and material consequences.

No change, clarification, escalation, and handoff are valid outcomes. If existing guidance was simply missed, apply or reference it. Propose a discovery fix only when the evidence supports one.

Show the proposed edit or bounded implementation plan before making durable changes. Follow the active approval rules. Invoking this skill does not approve unseen changes to instructions, product behavior, dependencies, or hooks. If the user already approved the exact change, do not ask again.

After approval, use the owning workflow instead of copying its procedure here. Follow `coding-guidelines` for code and `ste-prose` for durable prose. Use OptMem through its prescribed tool. A larger implementation or another owner's change can require a handoff.

Check the result at its actual point of use: run the check, exercise the behavior, or verify that the intended workflow loads the guidance. Report what changed, where it lives, and what you verified. Mark anything you could not verify.

## Examples

- **“Use camelCase for names.”** Identify the language, affected names, and external contracts. An existing lint rule may fit; do not assume this authorizes renaming public fields.
- **“Auth expires after 30 minutes of inactivity.”** Distinguish current behavior from a requirement. Check the implementation and tests, including what resets the clock. Unresolved conflicts about duration or expiry conditions require escalation.
- **“Show me when explaining a large feature.”** Check existing explanation guidance first. If the global prompt already points to `show-me`, another copy of the rule may add no value.
- **“Skip subagents for the rest of this session.”** Keep the direction session-scoped. Do not rewrite the global delegation policy.
- **“Check available models before choosing a subagent model.”** Check the relevant tool descriptions first. Keep tool-specific guidance with the tool instead of duplicating it in the system prompt.
- **“Preserve this explanation in the project knowledge base through its maintenance workflow.”** Prepare a handoff when another workflow owns information. Do not create a parallel knowledge base.
