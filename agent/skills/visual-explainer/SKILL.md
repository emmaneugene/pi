---
name: visual-explainer
description: Generate self-contained HTML visual explanations for systems, code changes, plans, data, and technical concepts. Use for diagrams, architecture overviews, diff or plan reviews, project recaps, comparison tables, slide decks, and other visual explanations.
---

# Visual Explainer

Produce a self-contained HTML page that makes one thing genuinely understood. You own the structure: pick the sections, diagram language, and depth that fit the content. This skill supplies the quality bar, the house design language, and the few building blocks that are hard to get right — not a page recipe.

**Boundary**: static explanatory documents (interactivity limited to zoom/pan, collapsibles, quiz reveals, slide nav). If the user needs a real app — state management, routing, forms, editable data — use the `web-app-builder` skill instead.

## Interactive vs pipeline use

**Interactive session (a person asked for an explainer): interview, then build iteratively. Do not one-shot.**

1. **Interview first.** Ask 2–3 questions before writing anything: who reads this and what do they already know; what specifically is confusing or what decision the page must support; overview or deep walkthrough. Skip only what the conversation already answered.
2. **Skeleton before flesh.** Deliver a thin version first — title, section outline, one representative diagram, the core example you intend to trace through. Ask what's missing or wrong.
3. **Build out on feedback.** Deepen the sections that matter to the reader; cut the ones that don't. Repeat until the reader says it lands.

**Pipeline artifact (subagent output, journey runbook, unattended generation): one-shot is correct.** Apply the same quality bar; skip the interview.

## Quality bar

These three properties are what make an explainer worth reading. Check each before delivery.

1. **Real walkthroughs with concrete examples.** Trace actual-looking data through the system end to end — a named campaign, a real-shaped SQL row, a specific request payload — not labeled boxes and abstract nouns. Pick one or two worked examples early and reuse them across every section so the reader follows a single thread. Diagrams show the example values flowing, not just component names.
2. **Well-labeled diagrams that map structure cleanly.** Data flows, hierarchies, and interface boundaries each get a diagram whose every node, edge, and boundary is labeled with what it _is_ and what _crosses_ it. If a diagram needs a paragraph to be understood, redraw the diagram. Split anything with 15+ elements into an overview plus detail views.
3. **Narrative a five-year-old could follow.** Simple, connected writing: each section states plainly what the reader now knows and why the next section follows. Apply the `ste-prose` skill to the prose — one meaning per word, active voice, short sentences. Define every term at first use or link it to a definition. No section may depend on knowledge the page hasn't built yet.

A quiz (4–6 medium-difficulty multiple-choice questions with click-to-reveal answers) is a good closer for teaching-oriented pages — answerable only if the reader understood the substance, no gotchas.

## Design language

Keep one consistent visual identity across explainers so a reader moving between pages never re-learns the vocabulary:

- **Cool-slate, light by default**: grey `#f6f7f9` page, white surfaces, navy `#10192b` text, teal-led jewel-tone accents (amber/blue/red/green for states). Dark or adaptive theming only on request.
- Depth via borders, surface contrast, and spacing — plain backgrounds, restrained shadows, no texture or gradient atmosphere.
- One display typeface for headings with strong size contrast, one mono face for code and meta lines, always with fallbacks.
- Exact tokens live in `./references/css-patterns.md` (Theme Setup); the diagram shell template already applies them.

Within that identity, vary layout and composition freely to serve the content.

## Building blocks

- **Single self-contained file.** Inline CSS/JS; CDN links only for libraries (Mermaid, Chart.js, Google Fonts — always with font fallbacks).
- **Semantic HTML** for tables, headings, lists, `<details>`, and captions. Long pages get a table of contents; make a skippable `<details>` primer for background the expert reader already has.
- **Mermaid diagram shell.** Never emit a bare `<pre class="mermaid">`. Start complex diagrams from `./templates/mermaid-flowchart.html` — it wires zoom, pan, fit, 1:1, and expand controls. Use `theme: 'base'` with page-matched variables; quoted labels with `<br/>` (never `\n`); never define a page-level `.node` CSS class (Mermaid uses it).
- Other files under `./templates/` and `./references/` are legacy reference material — consult them only when stuck on a specific mechanism (slide chrome, responsive nav, bespoke SVG diagrams), not as required reading or page recipes.
- **Hand-built HTML/inline-SVG diagrams** when the point is visual weight, layering, or mass rather than graph structure — Mermaid can't do editorial emphasis.
- **Slides on request only**: one `100dvh` viewport per slide, visible prev/next + keyboard nav, and no dropped content to hit a slide count.

## Hard-won gotchas

- Code blocks: `white-space: pre-wrap; overflow-wrap: break-word;` or long lines silently overflow.
- Global overflow guard: `overflow-x: hidden` on body plus `min-width: 0` on grid/flex children; check at normal desktop width before delivery.
- Never `display: flex` on `<li>` — it destroys list markers. Custom-numbered lists need explicit counters.
- Wrap animations in `@media (prefers-reduced-motion: no-preference)`; animate only to clarify state or hierarchy.
- Verify the delivered file opens with no console errors and the main idea is visible in the first viewport.
