# Writing Guidelines

Core principles outrank mechanical rules. In review mode, a core-principle violation is a bigger finding than a mechanical one.

## Core principles

1. **Signal density over brevity.** Every line carries information the reader needs; cut filler, but never cut detail that would force the reader to look elsewhere.
2. **Right detail in the right place.** Relocate, don't delete: overview here, depth in the linked doc, operational detail in the ticket/runbook. A trimmed document points to where the detail went.
3. **Lead with the answer.** State the conclusion, result, or recommendation first; caveats and context after, only if they change what the reader does.
4. **Source fidelity.** When an authoritative source exists (spec, RFC, error message, API doc), use its exact wording; don't paraphrase. Keep claims traceable to files, lines, or sources actually read.
5. **Names are prose.** Titles, headings, file names, and identifiers should describe behavior or content; a reader should predict what's inside from the name alone.
6. **Concrete examples.** Explain concepts through examples with realistic data. Scale visuals to complexity: plain text, then ASCII/Mermaid, then full HTML.
7. **Honest and direct, both ways.** State problems plainly without softening; state praise plainly without inflating. No hedging.

## Register by medium

| Medium                           | Register                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Chat responses                   | Core principles, voice & tone, and AI-tells apply; skip artifact mechanics (TL;DR openers, heading/structure rules)                |
| Docs, READMEs, explainers        | Full guidelines; TL;DR opener; exemplar voice                                                                                      |
| Handoffs, specs, reports         | Dense and scannable: tables, bullets, code blocks over prose paragraphs. Written to files, not context, so completeness is correct |
| Commit messages, PR descriptions | Imperative subject line; body says what changed and why; never narrates the process of writing the change                          |
| Code comments                    | Only what the code cannot say; one line preferred                                                                                  |

## Exemplar voices

One exemplar per piece; imitate the named qualities, not the mannerisms; never blend exemplars.

- **Conceptual explainers, deep dives**: Martin Kleppmann — patient build-up from concrete examples, honest caveats stated plainly, one idea per sentence. Classic style: prose as a clear window onto the subject.
- **How-to, reference**: Stripe-documentation register — terse, exact, exhaustive where it counts, zero marketing.
- **Essays, opinions, recaps**: Paul Graham plainness — short words, direct claims, no throat-clearing.

## Voice & tone

- Active voice. Mental test: append "by monkeys". If the sentence parses, rewrite
- Direct address: `you`, never `the user` or `one can`
- Imperative for steps: "Click **Add Project**", not "You will need to click **Add Project**"
- Sentences under 20 words target
- Contractions encouraged (`you'll`, `it's`) for warmth
- Present tense unless describing future behavior
- Limit `we`: only for a real acting group ("we decided"), never as a stand-in for "you"
- No rhetorical questions (sounds like marketing)
- Second-read test: read each sentence once at speech pace; if you re-read to parse it, name the subject, the action, and the consequence

## Concision

- Earn every detail: cut a number, name, or implementation detail if a more general phrasing wouldn't change the reader's understanding or action
- Weasel words: replace vague qualifiers (`significantly`, `many`, `often`, `typically`, `generally`) with a specific number or claim
- Vague quantifiers: no `near-zero`, `sub-second`, `most requests`; give the figure and cite it
- Filler/metaphor verbs: name the action instead of reaching for cadence (`moves through`, `lands`, `carries`, `hits` → the literal step)
- Include rationale only when the reader would make the wrong choice without it; if the code or context makes it obvious, omit

## AI-generated tells (flag these)

- Summary-style transitions: never open a paragraph by recapping the last one (`With this setup complete…`, `Now that we've explored…`); pivot straight to the next point
- Stop-start sentences: don't split one dependent idea into choppy fragments; short sentences for emphasis are fine
- Spec-sheet voice: rewrite sentences that read like a system reading a datasheet (`provides`, `is configurable`, `is explicitly labeled`)
- Cold-open paragraphs: a body paragraph whose first sentence works as a standalone heading has no antecedent; carry the prior subject forward
- Personified artifacts: machines don't perform human-physical actions (`hand the browser a URL` → `the browser fetches the URL`)
- Reused framing: the angle must come from this piece, not a template (`The question most teams face is whether…`)

## Tone, by content type

- **Tutorial**: warm, encouraging, predictable structure, no traps
- **How-to**: terse, direct (reader is mid-task)
- **Reference**: neutral, exhaustive, quotable
- **Conceptual**: explain like the reader will teach it back; examples and analogies welcome
- **Troubleshooting**: empathetic but not apologetic; acknowledge then fix

## Headings

- Sentence case for headings: "Configure environment variables", not "Configure Environment Variables"
- Subheadings descriptive, not cute: "Caveats when self-hosting", not "Caveats"
- Reader should be able to guess section content from the heading alone

## Structure

- Docs open with a one-paragraph TL;DR of what the page covers
- Every major section opens with a summary sentence
- Acronyms spelled out on first use
- Define every term the first time you use it
- Keep paragraphs to 2 to 4 sentences; split anything longer or covering two ideas

## Lists

- Three or more list-shaped items in a paragraph: convert to a list
- Bulleted for unordered; numbered for ordered (lifecycles, sequential steps)
- Always introduce a list with a colon
- No periods at the end of list items unless they are full sentences
- Bold/description format: `- **Term**: description here` (colon after bold term)

## Code

- Code blocks need a language tag for syntax highlighting
- Match the language and idioms of the surrounding ecosystem
- ≤80 columns per line in snippets; ≤25 lines per snippet; split longer blocks with prose
- Omit defaults; don't repeat variable definitions
- Minimal comments in code blocks; prefer prose explanation
- Explain what every code block does in prose (don't drop and run)
- Don't reference full example files at the end of guides; the guide is the deliverable

## Placeholders

- Text placeholders: `snake_case`, descriptive: `your_access_token_here` (double-click-selectable)
- Number placeholders: count up `1234567890123` (recognizable as fake, predictable)
- Never `<TOKEN>`, `xxx`, `your-token`, or generic ALL_CAPS

## Data sizes & units

- Space + uppercase unit: `64 KB`, `5 KB`, `200 ms`
- Exception: seconds is bare: `30s`
- Consistent across a document so readers can develop scanning habits

## Emphasis

- **Bold** means UI element or critical fact, never emphasis-for-emphasis-sake
- Reaching for bold for tone: the sentence is weak; rewrite it
- `Inline code` for paths, file extensions, identifiers, short snippets
- Rule: if it would look weird without a monospace font, monospace it

## Punctuation

- No em dashes (`—`) as punctuation in flowing prose; use colons, commas, periods, or rephrase

## Source formatting

- Don't hard-wrap paragraphs: each paragraph is one line in source
- One blank line before headings; one blank line before and after code blocks
- No `---` horizontal rules between sections

## Links

- Anchor text names the destination; never bare URLs or `here`/`link`
- Link a term's definition the first time it appears

## Anti-patterns (review-mode checklist)

- Burying the answer below context the reader didn't need yet
- Detail deleted instead of relocated (reader now has to ask)
- Paraphrased spec/error wording where the exact text was available
- Generic names: headings, titles, or files a reader can't predict content from
- Passive voice (apply "by monkeys" test)
- Title Case in headings
- Generic placeholders: `<TOKEN>`, `xxx`, `your-token`
- Code blocks without a language tag, or over 25 lines without prose between
- Hard-wrapped prose paragraphs; `---` rules between sections
- Subheadings that are single generic words: `Overview`, `Caveats`, `Notes`
- Bold used for emphasis instead of UI element or critical fact
- Page or section without an opening summary
- Acronyms used before being spelled out
- Bare unit numbers (`64KB`, `200MS`)
- "We" standing in for "you"; rhetorical questions
- Weasel words and uncited quantifiers
- Summary-style transitions; stop-start fragments; spec-sheet voice; cold-open paragraphs; personified artifacts; template framing
- Sentences that need a second read to parse
- Paragraphs over 4 sentences or covering two ideas
- Bare URLs or `here`/`link` as anchor text
- Em dashes as punctuation in flowing prose

## Review output format

Group by file. Use `file:line` format (editor-clickable). Terse findings: state issue + location, skip explanation unless the fix is non-obvious. No preamble. Lead with core-principle findings, then mechanical.

```text
## docs/setup.md

docs/setup.md:3 - answer buried; TL;DR missing, page opens with history
docs/setup.md:24 - passive voice ("the sandbox is created…")
docs/setup.md:58 - code block missing language tag
docs/setup.md:71 - placeholder <TOKEN> → your_access_token_here
docs/setup.md:102 - H2 "Caveats" too generic; add specificity

## docs/cli.md

✓ pass
```
