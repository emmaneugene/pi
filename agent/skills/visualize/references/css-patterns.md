# CSS Patterns for Diagrams

Reusable patterns for layout, connectors, theming, and visual effects in self-contained HTML diagrams.

## Theme Setup

Default to light mode: cool-slate `--bg` (`#f6f7f9`), white `--surface`, navy `--text` (`#10192b`), slate `--text-dim` (`#5b6472`), low-alpha cool borders. Accents are teal-led (`#0f766e`), plus amber / blue / red / green. Do not add a `@media (prefers-color-scheme: dark)` override or auto-switching by default — add dark only when the user explicitly asks.

```css
:root {
  --font-body: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", "SF Mono", Consolas, monospace;

  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-elevated: #ffffff;
  --surface2: #eef0f3; /* cool recessed panel */
  --border: rgba(15, 23, 42, 0.09);
  --border-bright: rgba(15, 23, 42, 0.18);
  --text: #10192b;
  --text-dim: #5b6472;
  --accent: #0f766e; /* teal — primary */
  --accent-dim: rgba(15, 118, 110, 0.1);
  /* Muted jewel-tone semantic accents */
  --blue: #1d4ed8;
  --blue-dim: rgba(29, 78, 216, 0.09);
  --amber: #b45309;
  --amber-dim: rgba(180, 83, 9, 0.1);
  --green: #15803d;
  --green-dim: rgba(21, 128, 61, 0.09);
  --red: #b91c1c;
  --red-dim: rgba(185, 28, 28, 0.08);
}
```

**Opt-in dark mode (only when the user asks).** Keep the light `:root` above as the default and layer dark on top — never make dark the default:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-elevated: #1c2333;
    --border: rgba(255, 255, 255, 0.06);
    --border-bright: rgba(255, 255, 255, 0.12);
    --text: #e6edf3;
    --text-dim: #8b949e;
    --accent: #22d3ee;
    --accent-dim: rgba(34, 211, 238, 0.12);
  }
}
```

## Code Blocks

Code blocks need explicit whitespace preservation and a max-height constraint, or code runs together and long files overwhelm the page.

### Basic Pattern

```css
.code-block {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  /* CRITICAL: preserve line breaks and indentation */
  white-space: pre-wrap;
  word-break: break-word;
}

/* Constrain height for long code */
.code-block--scroll {
  max-height: 400px;
  overflow-y: auto;
}
```

```html
<pre class="code-block code-block--scroll"><code>// Your code here
function example() {
  return true;
}</code></pre>
```

### Implementation Plans: Don't Dump Full Files

For implementation plans and architecture docs, don't display entire source files inline.

1. **Show structure, not code:**

   ```html
   <div class="file-structure">
     <div class="file-structure__path">src/extension.ts</div>
     <ul class="file-structure__outline">
       <li>
         <code>BOOMERANG_INSTRUCTIONS</code> — System prompt for autonomous mode
       </li>
       <li><code>clearState()</code> — Reset extension state</li>
     </ul>
   </div>
   ```

2. **Use collapsible sections for full code:**

   ```html
   <details class="collapsible">
     <summary>Full implementation (87 lines)</summary>
     <pre class="code-file__body"><code>...</code></pre>
   </details>
   ```

**Anti-patterns:** full source files inline (100+ lines); code blocks without `white-space: pre-wrap` (text runs together); no height constraint on long code (endless scroll).

If someone needs the full file, put it in a collapsible section or link to it.

## Directory Tree

For file structures, use `<pre>` with monospace + `white-space: pre`. Tree connectors (`├──`, `└──`, `│`) only work when vertically aligned — they become noise if text wraps.

```css
.dir-tree {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  overflow-x: auto;
  white-space: pre;
}

.dir-tree .ann {
  color: var(--text-dim);
  font-size: 11px;
  font-style: italic;
}
.dir-tree .hl {
  color: var(--accent);
  font-weight: 600;
}
```

```html
<pre class="dir-tree">my-project/
├── src/
│   ├── <span class="hl">index.ts</span>       <span class="ann">— entry point</span>
│   ├── services/
│   │   └── <span class="hl">api.py</span>     <span class="ann">(142 lines)</span>
│   └── utils/
├── tests/            <span class="ann">(14 test files)</span>
└── README.md</pre>
```

Never render tree connectors inside wrapping text (`white-space: normal`), flex children, or grid items — the vertical pipes lose alignment.

## Overflow Protection

Grid and flex children default to `min-width: auto`, which prevents them from shrinking below their content width. Long text, inline code badges, and non-wrapping elements will blow out containers.

### Global rules

```css
/* Every grid/flex child must be able to shrink */
.grid > *,
.flex > *,
[style*="display: grid"] > *,
[style*="display: flex"] > * {
  min-width: 0;
}

/* Long text wraps instead of overflowing */
body {
  overflow-wrap: break-word;
}
```

### Never use `display: flex` on `<li>` for marker characters

An anonymous flex item wraps the text content and gets `min-width: auto`, which cannot be overridden with `min-width: 0` because it is an anonymous box. Lines with inline `<code>` badges then overflow with no CSS fix possible. Use absolute positioning for markers instead:

```css
/* WRONG — causes overflow with inline code badges */
li {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
li::before {
  content: "›";
  flex-shrink: 0;
}

/* RIGHT — text wraps normally */
li {
  padding-left: 14px;
  position: relative;
}
li::before {
  content: "›";
  position: absolute;
  left: 0;
}
```

### List markers overlapping container borders

`list-style-position: outside` places markers outside the content box. Inside a bordered container, they can overlap or extend past the border.

```css
/* WRONG — markers overlap container border */
.card ol,
.card ul {
  padding-left: 20px; /* Not enough for outside markers */
}

/* RIGHT — use inside positioning */
.card ol,
.card ul {
  list-style-position: inside;
}

/* OR — adequate padding for outside markers */
.card ol,
.card ul {
  padding-left: 2em; /* ~32px gives room for markers */
}
```

**Rule of thumb:** any `<ol>`/`<ul>` inside a bordered container needs `list-style-position: inside` or `padding-left: 2em` minimum — the default 20px is not enough for outside-positioned markers.

## Mermaid Containers

Mermaid diagrams have two common layout issues: they render too small to read, and they left-align in their container leaving dead space.

**Never use `.node` as a page-level CSS class name.** Mermaid uses `.node` internally on its SVG `<g>` elements with `transform: translate(x, y)`. Page-level `.node` styles (hover transforms, box-shadows, transitions) leak into Mermaid diagrams and break their layout.

### Centering (Required)

Mermaid SVGs render at a fixed size based on content and default to top-left alignment without explicit centering. Always center them.

```css
/* WRONG — diagram hugs left edge */
.mermaid-container {
  padding: 24px;
  border: 1px solid var(--border);
}

/* RIGHT — diagram centers in container */
.mermaid-wrap {
  display: flex;
  justify-content: center;
  align-items: flex-start; /* or center for shorter diagrams */
  padding: 24px;
  border: 1px solid var(--border);
}
```

### Scaling Small Diagrams

Mermaid sizes diagrams based on content, not container. Complex diagrams with many nodes render small to fit everything. Three fixes:

**1. Increase fontSize in themeVariables** (most effective):

```javascript
mermaid.initialize({
  theme: "base",
  themeVariables: {
    fontSize: "18px", // default is 16px, bump to 18-20px for complex diagrams
  },
});
```

**2. CSS zoom** for _static_ diagrams not using the interactive `diagram-shell` engine (the engine below auto-fits, so this hack is only for non-interactive embeds):

```css
.mermaid-wrap--scaled .mermaid {
  zoom: 1.3;
}
```

**3. Constrain container width** so the diagram doesn't float in dead space:

```css
.mermaid-wrap--constrained {
  max-width: 800px;
  margin: 0 auto;
}
```

**Rule of thumb:** if the diagram has 10+ nodes or the text is smaller than 12px rendered, increase fontSize to 18-20px or apply CSS zoom.

### Zoom Controls

Add zoom controls to every `.mermaid-wrap` container for complex diagrams. If a diagram has fewer than ~7 nodes with no branching, it renders tiny in a full-viewport slide container — use CSS pipeline cards instead (see `templates/slide-deck.html`'s CSS Pipeline slide). Reserve Mermaid for graphs where automatic edge routing is actually needed.

### Canonical interactive pattern

Use `templates/mermaid-flowchart.html` as the source for `diagram-shell` HTML, CSS, and JavaScript. Do not copy a partial implementation from this reference. The template owns:

- per-diagram state without hardcoded IDs;
- zoom, pan, fit, 1:1, and expand controls;
- wheel, pointer, touch, and double-click interactions;
- adaptive sizing and readability floors;
- shared drag state and error handling.

Each diagram uses this structure:

```text
.diagram-shell
  .mermaid-wrap
    .zoom-controls
    .mermaid-viewport
      .mermaid.mermaid-canvas
  script.diagram-source[type="text/plain"]
```

Page-specific CSS may size `.mermaid-wrap`, but it must not replace the template's interaction engine or force `width: 100% !important` on the generated SVG.

### Mermaid SVG insertion

Mermaid 10+ can emit HTML inside SVG `<foreignObject>` labels, including unclosed HTML tags such as `<br>`. Do not parse Mermaid output with `DOMParser(..., 'image/svg+xml')`: the strict XML parser can silently truncate labels or edges. Avoid `canvas.innerHTML = svg` too — security scanners often flag it as an HTML sink.

Use `DOMParser(..., 'text/html')`, then adopt the parsed `<svg>` node into the canvas. The HTML parser accepts Mermaid's label markup and preserves the SVG namespace for browser rendering.

## Data Tables

Use real `<table>` elements for tabular data. Wrap in a scrollable container for wide tables.

```css
/* Scrollable wrapper for wide tables */
.table-wrap {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* Base table */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;
}

/* Header */
.data-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}

.data-table th {
  background: var(--surface-elevated, var(--surface2, var(--surface)));
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  text-align: left;
  padding: 12px 16px;
  border-bottom: 2px solid var(--border-bright);
  white-space: nowrap;
}

/* Cells */
.data-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  color: var(--text);
}

/* Alternating rows */
.data-table tbody tr:nth-child(even) {
  background: var(--accent-dim);
}

/* Row hover */
.data-table tbody tr {
  transition: background 0.15s ease;
}

.data-table tbody tr:hover {
  background: var(--border);
}

/* Last row: no bottom border (container handles it) */
.data-table tbody tr:last-child td {
  border-bottom: none;
}

/* Code inside cells */
.data-table code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--accent-dim);
  color: var(--accent);
  padding: 1px 5px;
  border-radius: 3px;
}
```

### Status Indicators

Styled spans for match/gap/warning states. Never use emoji.

```css
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

.status--match {
  background: var(--green-dim, rgba(5, 150, 105, 0.1));
  color: var(--green, #059669);
}

.status--gap {
  background: var(--red-dim, rgba(239, 68, 68, 0.1));
  color: var(--red, #ef4444);
}

.status--warn {
  background: var(--orange-dim, rgba(217, 119, 6, 0.1));
  color: var(--orange, #d97706);
}
```

### Table Summary Row

For totals, counts, or aggregate status at the bottom:

```css
.data-table tfoot td {
  background: var(--surface-elevated, var(--surface2, var(--surface)));
  font-weight: 600;
  font-size: 12px;
  border-top: 2px solid var(--border-bright);
  border-bottom: none;
  padding: 12px 16px;
}
```

### Sticky First Column (for very wide tables)

```css
.data-table th:first-child,
.data-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface);
}

.data-table tbody tr:nth-child(even) td:first-child {
  background: color-mix(in srgb, var(--surface) 95%, var(--accent) 5%);
}
```

## Connectors

### CSS Arrow (vertical, between stacked sections)

```css
.flow-arrow {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 6px 0;
}

/* Down arrow via SVG icon */
.flow-arrow svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--border-bright);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

Down arrow SVG (reuse inline):

```html
<svg viewBox="0 0 20 20"><path d="M10 4 L10 16 M6 12 L10 16 L14 12" /></svg>
```

### CSS Arrow (horizontal, between inline steps)

Use `::after` or a literal arrow character:

```css
.h-arrow::after {
  content: "→";
  color: var(--border-bright);
  font-size: 18px;
  padding: 0 4px;
}
```

### SVG Curved Connector (between arbitrary nodes)

For connections that aren't simple vertical/horizontal, use an absolutely positioned SVG overlay:

```html
<svg
  class="connectors"
  style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"
>
  <path
    d="M 150,100 C 150,200 350,100 350,200"
    fill="none"
    stroke="var(--accent)"
    stroke-width="1.5"
    stroke-dasharray="4 3"
  />
  <!-- Arrowhead -->
  <polygon points="348,195 352,205 356,195" fill="var(--accent)" />
</svg>
```

Position the parent container as `position: relative` to scope the SVG overlay.

## Bespoke (non-Mermaid) Diagram Patterns

When the point is _editorial_ — weight, mass, layering — hand-build the diagram with `<div>`s and inline SVG instead of Mermaid. Keep each ~280–340px tall so before/after sits side by side without scrolling. Use `--font-mono`, 11px, uppercase for in-diagram labels so they read as schematic, not UI.

### Hand-built boxes-and-arrows

Reach for this when Mermaid's auto-layout fights you, or the "after" should feel like one thick-bordered block with greyed-out internals (a weight Mermaid won't render). Modules are bordered `<div>`s; arrows are inline SVG `<line>`/`<path>` over a `position: relative` container (see SVG Curved Connector above). Fade now-internal nodes with `opacity: 0.45`.

### Cross-section (layered shallowness)

Stack horizontal bands to show the layers a call passes through. Before: many thin bands each doing almost nothing. After: one thick band labelled with the consolidated responsibility.

```css
.xsection {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.xsection__band {
  border-left: 4px solid var(--border);
  background: var(--surface);
  padding: 8px 14px;
  font: 11px/1 var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
}
.xsection__band--thin {
  height: 28px;
}
.xsection__band--deep {
  height: 96px;
  border-left-color: var(--accent);
  color: var(--text);
}
```

### Mass diagram (interface vs implementation)

Two stacked rectangles per module: interface surface area on top, implementation below. Shallow modules show an interface rectangle nearly as tall as the implementation; deep modules show a short interface over a tall implementation.

```css
.mass {
  display: inline-flex;
  flex-direction: column;
  width: 140px;
}
.mass__interface {
  background: var(--accent-dim);
  border: 1px solid var(--accent);
}
.mass__impl {
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: none;
}
/* shallow: interface ~60px / impl ~70px ; deep: interface ~22px / impl ~150px */
```

### Call-graph collapse

Before: a tree of calls as nested boxes. After: the same tree collapsed into one box with the now-internal calls shown faded inside it. Pairs with the boxes-and-arrows pattern for the "before" half.

## Responsive Breakpoint

Include a single breakpoint for narrow viewports:

```css
@media (max-width: 768px) {
  .arch-grid {
    grid-template-columns: 1fr;
  }
  .pipeline {
    flex-wrap: wrap;
    gap: 8px;
  }
  .pipeline__arrow {
    display: none;
  }
  body {
    padding: 16px;
  }
}
```

## Animations

### Staggered Fade-In on Load

Define the keyframe once, then stagger via a `--i` CSS variable set per element. This works regardless of DOM nesting, unlike `nth-child` which breaks when siblings aren't all the same type.

```css
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ve-card {
  animation: fadeUp 0.4s ease-out both;
  animation-delay: calc(var(--i, 0) * 0.05s);
}
```

Set `--i` per element in the HTML to control stagger order:

```html
<div class="ve-card" style="--i: 0">First</div>
<div class="connector">...</div>
<div class="ve-card" style="--i: 1">Second</div>
```

### Respect Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Slides

Slides are on request only. Start from `templates/slide-deck.html` — it already wires the deck engine, auto-fit, and responsive height breakpoints for all 10 slide types.

### Content Density Limits

Each slide fits in exactly 100dvh. If content exceeds a limit, split across slides — never scroll within one.

| Slide type      | Max content                                                            |
| --------------- | ---------------------------------------------------------------------- |
| Title           | 1 heading + 1 subtitle                                                 |
| Section Divider | 1 number + 1 heading + optional subhead                                |
| Content         | 1 heading + 5–6 bullets (max 2 lines each)                             |
| Split           | 1 heading + 2 panels, each follows its inner type's limits             |
| Diagram         | 1 heading + 1 Mermaid diagram (max 8–10 nodes)                         |
| Dashboard       | 1 heading + 6 KPI cards; hero values ≤6 chars                          |
| Table           | 1 heading + 8 rows; overflow paginates to the next slide               |
| Code            | 1 heading + 10 lines of code                                           |
| Quote           | 1 quote (≤150 chars) + 1 attribution; longer quotes are content slides |
| Full-Bleed      | 1 heading + 1 subtitle over background                                 |
