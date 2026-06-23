---
name: simplify-writing
description: Simplify prose by cutting filler while preserving meaning. Use when this skill proactively, and when the user asks to simplify, tighten, trim, condense any piece of writing.
---

## Core principle

Cut useless words. The goal is prose that lands the point in fewer words without losing meaning or accuracy. Every edit must pay its way: it should remove words, sharpen a verb, or end a sentence sooner — while keeping the original meaning intact. Preserve the author's facts, technical terms, names, code, URLs, and quotations exactly.

## Rules

Apply these in order. Each later rule assumes the earlier ones are done.

1. **Cut hype.** Delete hype that adds no information: "it's important to note that," "it's worth mentioning," "plays a crucial role in," "in today's fast-paced world," "at the end of the day." State the fact directly.

2. **Use plain verbs.** Prefer the short, common verb over the Latinate one: _use_ not _utilize_, _help_ not _facilitate_, _show_ not _demonstrate_, _start_ not _initiate_, _end_ not _terminate_, _buy_ not _purchase_, _get_ not _obtain_.

3. **End the sentence at the fact.** Stop once the point lands. Cut trailing clauses that restate or gesture at implications: "...which allows you to do X," "...thereby enabling Y," "...ensuring that Z." If the reader already knows it, delete it.

4. **Kill nominalizations.** Turn noun-phrases back into verbs: _decide_ not _make a decision_, _fail_ not _experience a failure_, _consider_ not _give consideration to_, _apply_ not _make an application_.

5. **Earn every adjective and adverb.** If a modifier doesn't change the meaning, cut it: _very_, _really_, _quite_, _actually_, _basically_, _truly_, _significantly_, _highly_. Keep modifiers that carry real information (a _red_ button, a _3-second_ delay).

6. **One idea per sentence.** Split sentences chained with "and... which... thereby... so that...". Each sentence should carry a single claim the reader can hold.

## Workflow

1. Read the whole passage first to understand intent, audience, and any non-negotiable content (technical terms, legal phrasing, brand voice).
2. Apply the seven rules pass by pass, cutting rather than rewriting.
3. Preserve verbatim: code, commands, file paths, URLs, proper nouns, numbers, and direct quotations.
4. Do a final read for meaning drift — confirm nothing important was lost.
5. Report what changed at a high level (e.g., word count before/after, main cuts), not a line-by-line diff unless asked.

## Watchlist

Words and phrases that appear at elevated rates in padded or AI-generated prose. Treat each as a prompt to cut or simplify, not an automatic delete — context decides.

- **Hype nouns/verbs:** delve, leverage, harness, unlock, elevate, navigate (figurative), foster, empower, streamline, robust, seamless, holistic, comprehensive, cutting-edge, game-changing.
- **Filler openers:** "It's important to note," "It's worth mentioning," "Needless to say," "At its core," "When it comes to," "In order to" (→ "to").
- **Hedges that add nothing:** arguably, essentially, fundamentally, in essence, to some extent, in many ways.
- **Empty intensifiers:** very, really, quite, truly, highly, incredibly, extremely, significantly (when not quantified).
- **Structural tells:** every paragraph the same length; "Not only... but also"; "From X to Y to Z" triads; em-dash overuse; bolded mini-headers on every bullet; sycophantic openers ("Great question!").
- **Roundabout explanations:** "It's X, not Y", just get straight to X

For worked before/after examples, see `references/examples.md`.

## What NOT to do

- Don't strip meaning to hit a word count.
- Don't flatten a distinctive voice if the author has a deliberate style
- Don't touch quoted material, code, or data.
- Don't replace a precise technical terms (e.g. _idempotent_, _latency_, _p-value_).
- Don't add new claims or "improve" the argument.
