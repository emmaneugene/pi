---
name: ste-prose
description: "Author or review prose in ASD-STE100 style — one meaning per word, active voice, simple tense, short sentences. Use when writing prose that machines or non-native readers must parse without ambiguity (prompts, tool descriptions, error messages, inter-agent instructions, docs), and when asked to review or simplify such text; triggers: simplify this text, STE."
source: adapted from https://github.com/danyuchn/asd-ste100-skill/blob/master/SKILL.md
---

# STE Prose

ASD-STE100 is a controlled-language standard built by the aerospace and defense industry to stop maintenance technicians from misreading English instructions. It removes the two biggest sources of misreading: words with more than one meaning, and sentences with more than one possible structure.

This skill borrows that discipline for a different reader: an **AI agent or a downstream system** that has to parse an English string — an error message, a tool description, an inter-agent instruction, a status report — without a human in the loop to resolve ambiguity. If a maintenance technician can misread "close the valve" as an adjective ("the valve that is near") instead of a command, so can a language model.

## Modes

**Authoring** — you are writing new prose (a prompt, system message, tool description, error message, doc). Apply the rules directly as you write. Do not produce a violations report; the deliverable is the compliant text itself.

**Review** — you are given existing text to simplify. Follow the Process below and deliver the rewrite first (see Output Format).

Not for creative or marketing copy — STE is deliberately flat and literal. Do not apply it to text where voice, nuance, or persuasion is the point.

## Source and Scope

This skill encodes the **rule categories** of ASD-STE100 Issue 9 (Jan 2025): 53 writing rules across 9 sections, backed by a dictionary of ~900 approved words (one meaning, one part of speech each). See `references/writing-rules.md` for the rule summary and citations.

It does **not** reproduce ASD's approved dictionary verbatim. Instead it applies the underlying principle: pick the plainest, most common word available and use it the same way every time. When exact ASD-approved wording matters (e.g. actual aircraft maintenance documentation), download the official standard at https://www.asd-ste100.org/ and check word-by-word against the real dictionary.

## Core Rules

| Rule                         | Do                                                                                                                                   | Don't                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| One word, one meaning        | Pick one verb for one action and reuse it every time (e.g. always "check", never mix "check"/"verify"/"confirm" for the same action) | Rotate synonyms for the same idea across a document                                         |
| One part of speech per word  | "Apply oil to the valve" (oil = noun)                                                                                                | "Oil the valve" (oil = verb) — if "oil" is only approved as a noun                          |
| Active voice                 | "The agent deletes the file."                                                                                                        | "The file is deleted (by the agent)." — unless the actor is genuinely unknown or irrelevant |
| Simple tenses only           | "We received the report." (simple past)                                                                                              | "We have received the report." (present perfect)                                            |
| One instruction per sentence | "Open the file. Read line 3."                                                                                                        | "Open the file and read line 3, then check if it matches."                                  |
| Sentence length              | ≤20 words for instructions/procedures, ≤25 words for descriptions                                                                    | Long compound/subordinate-clause sentences                                                  |
| Noun clusters                | ≤3 words stacked as a noun phrase ("fuel pump valve")                                                                                | 4+ word noun stacks ("high pressure fuel pump inlet valve assembly")                        |
| No ellipsis                  | Keep the subject, verb, and article explicit even if it reads longer                                                                 | Drop words to save space ("Files not backed up will be lost" → ambiguous which files)       |
| Paragraph limits             | One topic per paragraph, ≤6 sentences                                                                                                | Multi-topic paragraphs                                                                      |
| Lists for sequences          | Use a numbered or bulleted list for 3+ steps or conditions                                                                           | Bury a sequence inside one prose sentence                                                   |
| Domain terms                 | Keep necessary technical nouns/verbs, but define them once if not common English                                                     | Use jargon without ever defining it                                                         |

## Review Process

1. Read the input text once for meaning — do not start rewriting before you understand what it must still say afterward.
2. Walk it sentence by sentence and flag every rule violation (word ambiguity, tense, voice, length, ellipsis, noun stacking).
3. Rewrite each flagged sentence to fix the violation while preserving the original meaning exactly. If a rewrite would drop necessary precision (a safety condition, a scope qualifier, a number), keep the longer phrasing and flag it instead of silently simplifying.
4. If the input already complies, say so — do not force changes onto compliant text.

## Output Format (Review Mode)

Deliver the **rewritten text first**, followed by a short note on anything you deliberately did **not** simplify, and why (usually: simplifying would lose required precision).

Produce a rule-by-rule diagnostic table only when the user asks for one:

```markdown
| Rule violated           | Original                                | Simplified                                  |
| ----------------------- | --------------------------------------- | ------------------------------------------- |
| Present perfect tense   | "We have received your request."        | "We received your request."                 |
| Noun cluster (4+ words) | "the agent task queue priority handler" | "the handler that sets task-queue priority" |
```

## Boundaries

**Will:**

- Write new prose that follows the rules above.
- Rewrite ambiguous or dense English into short, single-meaning, active-voice sentences.
- Preserve every fact, condition, and scope qualifier in the original.
- Suggest a one-line glossary entry for domain terms that must stay.

**Will not:**

- Reproduce ASD's official ~900-word dictionary as if it were memorized verbatim — treat the official download as the source of truth for exact approved wording.
- Simplify creative, marketing, or persuasive copy where voice and nuance are the point.
- Silently drop a safety condition, exception, or scope qualifier to shorten a sentence — flag the trade-off instead.
- Guarantee an aerospace/defense-grade STE-compliant document; this is a general-purpose clarity tool inspired by STE, not a certified STE authoring tool.

## Additional Resources

- **`references/writing-rules.md`** — rule categories in more detail (verb forms, voice, structure, safety instructions), with citations.
- **`examples/before-after.md`** — worked examples, including official STE examples and agent-output examples built for this skill.
