---
name: visual-explainer
description: Generate self-contained HTML visual explanations for systems, code changes, plans, data, and technical concepts. Use for diagrams, architecture overviews, diff or plan reviews, project recaps, comparison tables, slide decks, and other visual explanations.
source: https://github.com/nicobailon/visual-explainer/blob/main/plugins/visual-explainer
---

# Visual Explainer

Generate self-contained HTML pages that explain systems, code changes, plans, data, and technical concepts visually. Use this skill for diagram requests, architecture overviews, diff/plan reviews, project recaps, comparison tables, slide decks, and any visual explanation.

**Boundary**: This skill produces static explanatory documents (interactivity limited to zoom/pan, collapsibles, slide nav). If the user needs a real app - state management, routing, forms, editable data - use the `web-app-builder` skill instead.

## Reference routing

Read only the references needed for the current output:

| Need                                                                                                          | Read                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Text-heavy architecture/cards                                                                                 | `./templates/architecture.html`                                                                        |
| Mermaid flowcharts, sequence, ER, state, class, C4, data flow                                                 | `./templates/mermaid-flowchart.html`, Mermaid sections in `./references/libraries.md`                  |
| Data tables, comparisons, audits                                                                              | `./templates/data-table.html`                                                                          |
| Slide decks                                                                                                   | `./templates/slide-deck.html`, `./references/slide-patterns.md`                                        |
| CSS layout, overflow, depth, collapsibles, SVG connectors                                                     | `./references/css-patterns.md`                                                                         |
| Before/after diffs, bespoke non-Mermaid diagrams (cross-section, mass, call-graph collapse, hand-built boxes) | "Before / After Panels" and "Bespoke (non-Mermaid) Diagram Patterns" in `./references/css-patterns.md` |
| Pages with 4+ major sections                                                                                  | `./references/responsive-nav.md`                                                                       |
| Prose-heavy pages                                                                                             | “Prose Page Elements” in `css-patterns.md`, typography sections in `libraries.md`                      |

## Choose the representation

| Content                                                                                       | Default representation                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Flowchart, pipeline, state machine, decision tree                                             | Mermaid                                                      |
| Sequence, ER/schema, class, C4, topology-focused architecture                                 | Mermaid                                                      |
| Text-heavy architecture, module internals, implementation plans                               | CSS grid cards, optionally with a Mermaid overview           |
| 15+ element architecture                                                                      | Hybrid: small Mermaid overview + CSS detail cards            |
| Before/after, diff, migration, review (deep-dive teaching a diff/PR: use explainer-page mode) | Two-column before/after panels (diff-colored headers)        |
| UI change                                                                                     | Simplified hand-built UI mockup (HTML/CSS), before/after     |
| Editorial weight: shallowness, mass, layering, collapse                                       | Bespoke hand-built `<div>` + inline-SVG diagram, not Mermaid |
| Comparison/audit/status matrix                                                                | Semantic HTML `<table>`                                      |
| Timeline/roadmap                                                                              | CSS timeline                                                 |
| Dashboard/metrics (static snapshot; if user must manipulate data, use `web-app-builder`)      | CSS grid + charts/KPIs                                       |
| Slide deck                                                                                    | `100dvh` slides using slide template patterns                |

## Mermaid invariants

- Use `theme: 'base'` with custom `themeVariables` matching the page palette.
- For complex diagrams use ELK layout when available.
- Never use bare `<pre class="mermaid">`.
- Use the canonical `diagram-shell` pattern from `templates/mermaid-flowchart.html`: `.diagram-shell` > `.mermaid-wrap` > `.zoom-controls` + `.mermaid-viewport` > `.mermaid-canvas`.
- Every Mermaid diagram needs zoom in/out/fit/1:1/expand controls, Ctrl/Cmd+scroll zoom, drag panning, and double-click-to-fit. The expand control opens the diagram full-size in a new tab.
- Prefer `flowchart TD` for complex diagrams. Use `LR` only for simple 3–4 node linear flows.
- Use `<br/>` in quoted flowchart labels. Do not use escaped `\n` labels.
- Never define page-level `.node`; Mermaid uses it internally. Use namespaced page classes such as `.ve-card`.
- For 15+ elements, do not cram everything into one Mermaid diagram. Use the hybrid overview + cards pattern.
- Mermaid is the default for graph-shaped content, but do not route everything through it — it starts to look generic. For weight/mass/layering visuals, hand-build with `<div>`s + inline SVG (see `css-patterns.md`).

## Card anatomy

When content is rendered as CSS cards (architecture, plans, reviews), keep each card structurally disciplined:

- **Title** — short, names the thing; no filler.
- **Optional badge row** — status/strength (e.g. emerald = strong, amber = worth exploring, slate = speculative) and/or a category tag.
- **Optional file/meta line** — monospaced, small.
- **Body** — the diagram or content carries the weight; prose is sparse. If a diagram needs a paragraph to be understood, redraw the diagram.
- **Wins/takeaways** — short bullets, not paragraphs.
- **Optional callout** — one tinted line for an ADR/warning/note.

For before/after reviews, the two-column diff is the centerpiece of the card, not an afterthought.

## Explainer-page mode (teaching a change or system)

When the goal is understanding — explaining a diff, PR, or unfamiliar system in depth — structure the page as a narrative, not a card grid:

- **Sections**: Background → Intuition → Walkthrough → Quiz, with a table of contents. One long scrollable page; no top-level tabs.
- **Background**: broad primer for beginners inside a collapsible `<details>` (skippable), then the narrow context directly relevant to the change. Explore surrounding code first.
- **Intuition**: the essence, not the details. Concrete toy-data examples; diagrams carry the weight.
- **Walkthrough**: changes grouped and ordered for comprehension, not file order. Use before/after panels inside the narrative.
- **Quiz**: 4–6 interactive multiple-choice questions, medium difficulty — answerable only if the reader understood the substance, no gotchas. Clicking reveals correct/incorrect plus a one-line explanation.
- **Diagram families**: pick 1–3 diagram vocabularies early (e.g. simplified UI mockup for UI changes, data-flow/system diagram) and reuse them across sections with varying data. Do not invent a new visual language per section.
- **Diagrams show example data**, not just labeled boxes: real-looking values flowing through the system.
- **Prose breathes here**, unlike card pages: clear, flowing, classic style with smooth transitions. Use `.prose` patterns from `css-patterns.md` and callouts for definitions and edge cases.

## Layout and style invariants

- Use semantic HTML where it helps accessibility and copy/paste: `<table>`, headings, lists, `<details>`, captions.
- Use CSS custom properties for palette: `--bg`, `--surface`, `--border`, `--text`, `--text-dim`, and 3–5 accents.
- Default to a light-mode palette: light `--bg`/`--surface` with dark `--text`. Do not emit a `@media (prefers-color-scheme: dark)` override, OS-adaptive auto-switching, or `isDark` detection by default. Add a dark or adaptive theme only when the user explicitly asks; when you do, keep light as the `:root` default and layer dark on top.
- Pick a clear aesthetic direction before writing: blueprint, editorial, paper/ink, terminal, IDE-inspired, or data-dense.
- Avoid generic defaults: no body font that is only Inter, Roboto, Arial, Helvetica, or system-ui; no violet/fuchsia Tailwind-default accents as the main palette (`#8b5cf6`, `#7c3aed`, `#a78bfa`, `#d946ef`); no cyan+magenta+purple neon dashboard; no decorative gradient-mesh blobs (a subtle 2–3 radial atmosphere is fine).
- Good font pair families: DM Sans + Fira Code; Instrument Serif + JetBrains Mono; IBM Plex Sans + IBM Plex Mono; Bricolage Grotesque + Fragment Mono; Plus Jakarta Sans + Azeret Mono.
- Good accent directions: terracotta+sage, teal+slate, rose+cranberry, amber+emerald, deep blue+gold.
- Prevent overflow: `min-width: 0` on grid/flex children, `overflow-wrap: break-word` for long text, and scroll containers for wide tables/code.
- Do not set `display: flex` directly on `<li>` when list markers matter.
- Use depth sparingly: hero/elevated only for primary sections; flat/recessed for reference material.
- Use entrance/hover animation only when it clarifies hierarchy. Respect `prefers-reduced-motion`. Do not use continuous glow, pulse, or breathing effects on static content.

## Slide deck mode

Use slides only when explicitly requested or when a command asks for slides. Slides are a different medium, not a paginated article:

- Each slide is one viewport (`100dvh`) with no page-level scrolling.
- Use larger type, fewer objects per slide, varied compositions, and visible navigation.
- Include slide nav chrome from `slide-deck.html`: prev/next controls, slide count, keyboard navigation, and carousel dots/indicators.
- Before writing HTML, inventory the source and map every source item to slides.
- Do not drop content to fit a fixed slide count. Add slides instead.
- Use the 10 slide types from `slide-patterns.md`: Title, Section Divider, Content, Split, Diagram, Dashboard, Table, Code, Quote, Full-Bleed.

## Final checklist

Before delivery, verify:

- complete HTML document;
- output written to the requested path;
- no console errors when opened;
- no horizontal overflow at normal desktop width;
- fonts load with fallbacks;
- tables preserve rows/columns and wrap long text;
- Mermaid diagrams use `diagram-shell` with zoom/pan/expand;
- slides fit one viewport, include carousel dots, and preserve source coverage;
- visual hierarchy makes the main idea obvious in the first viewport;
