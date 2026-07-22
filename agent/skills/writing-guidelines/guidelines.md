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
- Direct address: `you`, never `the user`; imperative for steps: "Click **Add Project**"
- Sentences under 20 words target; present tense; contractions encouraged (`you'll`, `it's`)
- Limit `we`: only for a real acting group ("we decided"), never as a stand-in for "you"
- No rhetorical questions (sounds like marketing)
- Second-read test: read each sentence once at speech pace; if you re-read to parse it, name the subject, the action, and the consequence

## AI-generated tells (flag these)

- Weasel words and vague quantifiers: `significantly`, `many`, `often`, `near-zero`, `sub-second`; give the specific number or claim
- Filler/metaphor verbs: name the action instead of reaching for cadence (`moves through`, `lands`, `carries`, `hits` → the literal step)
- Summary-style transitions: never open a paragraph by recapping the last one (`With this setup complete…`, `Now that we've explored…`); pivot straight to the next point
- Stop-start sentences: don't split one dependent idea into choppy fragments; short sentences for emphasis are fine
- Spec-sheet voice: rewrite sentences that read like a system reading a datasheet (`provides`, `is configurable`, `is explicitly labeled`)
- Cold-open paragraphs: a body paragraph whose first sentence works as a standalone heading has no antecedent; carry the prior subject forward
- Personified artifacts: machines don't perform human-physical actions (`hand the browser a URL` → `the browser fetches the URL`)
- Reused framing: the angle must come from this piece, not a template (`The question most teams face is whether…`)
- Significance inflation: puffery like `pivotal moment`, `testament to`, `evolving landscape`; state what happened instead
- AI vocabulary: `delve`, `crucial`, `enhance`, `fostering`, `garner`, `interplay`, `intricate`, `pivotal`, `showcase`, `tapestry`, `underscore`, `vibrant`; replace with plain words
- Abstract metaphor nouns: `substrate`, `wedge`, `vector`, `nexus`, `primitive` (as noun), `harness`/`surface`/`scaffolding` (as metaphor), `paradigm`, `modality`; swap for the concrete word
- Plain-word swaps: `utilize` → use, `leverage` → use, `facilitate` → help, `in order to` → to, `due to the fact that` → because
- Copula avoidance: `serves as`, `stands as`, `boasts`, `features`; just say "is" or "has"
- Negative parallelism: `it's not just X, it's Y`; state the point directly
- Rule of three: don't force ideas into groups of three; use the natural count
- Synonym cycling: pick one name per concept and keep it (`bubble`/`message`/`row` in one paragraph makes the reader re-derive they're the same thing)
- Colon overuse: a colon introduces a list or example, not a mid-sentence comparison connector
- Inline-header restatement: a bold label followed by a sentence that restates the label (`**Performance:** Performance improved...`); a bold lead-in followed by genuinely new detail is fine
- Em dashes (`—`) as punctuation in flowing prose; use colons, commas, periods, or rephrase. Don't substitute parentheses or en dashes; that trades one tell for another
- Bold for emphasis or tone: the sentence is weak; rewrite it. Bold means UI element or critical fact

## Artifact mechanics

Apply to durable artifacts (docs, READMEs, handoffs), not chat.

- Docs open with a one-paragraph TL;DR; every major section opens with a summary sentence
- Paragraphs 2–4 sentences, one idea each; spell out acronyms and define terms on first use
- Sentence case for headings; descriptive, not cute ("Caveats when self-hosting", not "Caveats" or "Overview")
- Three or more list-shaped items → a list, introduced with a colon; numbered only for ordered steps; `- **Term**: description` format for definition lists
- Code blocks: language tag required; ≤80 columns, ≤25 lines; explain each block in prose
- Placeholders: descriptive `snake_case` (`your_access_token_here`), fake-obvious numbers (`1234567890123`); never `<TOKEN>`, `xxx`, or generic ALL_CAPS
- Units: space + uppercase (`64 KB`, `200 ms`); bare seconds (`30s`); consistent across the document
- `Inline code` for paths, identifiers, short snippets; if it looks weird without monospace, monospace it
- Anchor text names the destination; never bare URLs or `here`
- Source: one line per paragraph (no hard-wrapping); no `---` rules between sections

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
