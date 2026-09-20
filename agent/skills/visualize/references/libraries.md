# External Libraries (CDN)

Optional CDN libraries for cases where pure CSS/HTML isn't enough. Only include what the diagram actually needs — most diagrams need zero external JS.

## Mermaid.js — Diagramming Engine

Use for flowcharts, sequence diagrams, ER diagrams, state machines, mind maps, class diagrams, and any diagram where automatic node positioning and edge routing saves effort. Do NOT use for dashboards — CSS Grid + Chart.js looks better. Data tables use `<table>` elements.

```html
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

  // startOnLoad: false — the diagram-shell pattern (css-patterns.md) calls
  // mermaid.render() manually. startOnLoad: true double-renders there.
  mermaid.initialize({ startOnLoad: false /* ... */ });
</script>
```

### Deep Theming

Always use `theme: 'base'` — the only theme where all `themeVariables` are fully customizable. Built-in themes (`default`, `dark`, `forest`, `neutral`) ignore most variable overrides.

```html
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

  // Default to the light Mermaid palette. Only flip to
  // `window.matchMedia("(prefers-color-scheme: dark)").matches` (and add a dark
  // CSS override) when the user explicitly asks for dark/adaptive.
  const isDark = false;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    look: "classic",
    themeVariables: {
      // Background and surfaces — teal/slate palette (not violet/indigo!)
      primaryColor: isDark ? "#134e4a" : "#ccfbf1",
      primaryBorderColor: isDark ? "#14b8a6" : "#0d9488",
      primaryTextColor: isDark ? "#f0fdfa" : "#134e4a",
      secondaryColor: isDark ? "#1e293b" : "#f0fdf4",
      secondaryBorderColor: isDark ? "#059669" : "#16a34a",
      secondaryTextColor: isDark ? "#f1f5f9" : "#1e293b",
      tertiaryColor: isDark ? "#27201a" : "#fef3c7",
      tertiaryBorderColor: isDark ? "#d97706" : "#f59e0b",
      tertiaryTextColor: isDark ? "#fef3c7" : "#27201a",
      lineColor: isDark ? "#64748b" : "#94a3b8",
      fontSize: "16px",
      fontFamily: "var(--font-body)",
      noteBkgColor: isDark ? "#1e293b" : "#fefce8",
      noteTextColor: isDark ? "#f1f5f9" : "#1e293b",
      noteBorderColor: isDark ? "#fbbf24" : "#d97706",
    },
  });
</script>
```

**FORBIDDEN in Mermaid themeVariables:** `#8b5cf6`, `#7c3aed`, `#a78bfa` (indigo/violet), `#d946ef` (fuchsia). Use teal, slate, amber, emerald, or colors from the page's palette.

### CSS Overrides on Mermaid SVG

Override Mermaid's SVG classes for control that `themeVariables` can't reach:

```css
.mermaid-wrap {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  overflow: auto;
}

/* CRITICAL: force node/edge text to follow the page's color scheme. A classDef
   that sets color: hardcodes a single value that breaks in the opposite scheme —
   never set color: in classDef, and always include these overrides. */
.mermaid .nodeLabel {
  color: var(--text) !important;
}
.mermaid .edgeLabel {
  color: var(--text-dim) !important;
  background-color: var(--bg) !important;
}
.mermaid .edgeLabel rect {
  fill: var(--bg) !important;
}

.mermaid .node rect,
.mermaid .node circle,
.mermaid .node polygon {
  stroke-width: 1.5px;
}
.mermaid .edge-pattern-solid {
  stroke-width: 1.5px;
}

/* NEVER override font-family or font-size of .nodeLabel/.edgeLabel — Mermaid
   sizes label boxes at measure time, so post-render font changes clip them.
   Set fontFamily/fontSize via themeVariables instead, and render only after
   `await document.fonts.ready` so measurement uses the loaded webfont. */

.mermaid .actor {
  stroke-width: 1.5px;
}
.mermaid .messageText {
  font-family: var(--font-mono) !important;
  font-size: 12px !important;
}
.mermaid .er.entityBox {
  stroke-width: 1.5px;
}
.mermaid .mindmap-node rect {
  stroke-width: 1.5px;
}
```

### classDef and style Gotchas

`classDef` and per-node `style` directives are static text inside `<pre>` — they can't use CSS variables or JS ternaries.

1. **Never set `color:` in `classDef` or `style`.** It hardcodes a text color that breaks in the opposite color scheme (`classDef highlight fill:...,color:#2c2a25` and `style I fill:...,color:#2c2a25` both do this). Let the CSS overrides above handle text color via `var(--text)`.

2. **Use semi-transparent fills (8-digit hex) for node backgrounds.** They tint over Mermaid's base theme background so they work in both light and dark modes. Use `20`–`44` alpha for subtle, `55`–`77` for prominent:

```
classDef highlight fill:#b5761433,stroke:#b57614,stroke-width:2px
classDef muted fill:#7c6f6411,stroke:#7c6f6444,stroke-width:1px
```

Avoid opaque light fills like `fill:#fefce8` — they render as bright boxes in dark mode.

### Node Label Special Characters

Mermaid uses `/`, `\`, `(`, `{` for shape syntax (`[/text/]` parallelogram, `[(text)]` cylindrical, `((text))` circle, `{{text}}` hexagon, etc.). A label starting with one of these needs quotes:

```
%% WRONG — syntax error (/ starts parallelogram shape)
CMD[/gallery command] --> SRV[server]

%% RIGHT — quotes escape the special character
CMD["/gallery command"] --> SRV[server]
```

Edge labels with quotes inside need single quotes or no quotes:

```
%% WRONG
UI -->|"Use as Reference"| RET
%% RIGHT
UI -->|'Use as Reference'| RET
```

### stateDiagram-v2 Label Limitations

State diagram transition labels have a strict parser. Avoid `<br/>` (parse error — flowcharts only), parentheses (`cancel()` confuses the parser), and multiple colons (the first `:` is the label delimiter). Use a `flowchart` instead if you need multi-line labels or special characters — it supports quoted labels and `<br/>`.

### Writing Valid Mermaid

Most Mermaid failures come from a few recurring issues:

**Multi-line flowchart labels use `<br/>`, not `\n`** — `\n` renders as literal text: `A["Copilot Backend<br/>/api"]`, not `A["Copilot Backend\n/api"]`.

**Quote labels with special characters.** Parentheses, colons, commas, brackets, and ampersands break the parser unquoted: `A["handleRequest(ctx)"] --> B["DB: query users"]`.

**Keep IDs alphanumeric**, with the readable name in the label: `userSvc["User Service"] --> authSvc["Auth Service"]`.

**Aim for ≤12 nodes per diagram.** Beyond ~12, readability drops even with zoom and larger fontSize. Between 12–15, group related nodes with `subgraph` blocks; at 15+, use the hybrid pattern — a 5–8 node Mermaid overview followed by CSS Grid cards with detail. Never cram everything into one diagram.

**Arrow styles carry meaning:**

| Arrow          | Meaning | Use for                              |
| -------------- | ------- | ------------------------------------ |
| `-->`          | Solid   | Primary flow                         |
| `-.->`         | Dotted  | Optional, async, or fallback paths   |
| `==>`          | Thick   | Critical or highlighted path         |
| `--x`          | Cross   | Rejected or blocked                  |
| `-->\|label\|` | Labeled | Decision branches, data descriptions |

**Escape literal pipes** in labels with `#124;` — pipes delimit edge labels.

**Sequence diagram messages must be plain text.** Curly braces, square brackets, angle brackets, and `&` silently break the parser and the diagram renders as raw text — write `A->>B: Call web_search with queries`, not `A->>B: web_search({ queries: [...] })`.

**Don't mix diagram syntax.** `-->` works in flowcharts but not sequence diagrams (`->>` instead); `:::className` works in flowcharts but not ER diagrams.

### Layout Direction: TD vs LR

`flowchart LR` spreads horizontally; with many nodes Mermaid scales everything down to fit the width, making text unreadable. `flowchart TD` is almost always better.

| Direction            | Use when                                              | Avoid when                    |
| -------------------- | ----------------------------------------------------- | ----------------------------- |
| `TD` (top-down)      | Complex diagrams, 5+ nodes, hierarchies, architecture | Simple A→B→C linear flows     |
| `LR` (left-to-right) | Simple linear flows, 3-4 nodes, pipelines             | Complex graphs, many branches |

**Rule of thumb:** if the diagram has more than one row of nodes or any branching, use `TD`.

### Diagram Type Examples

> Place the diagram source inside the `diagram-shell` > `.diagram-source` structure from `css-patterns.md` — never ship a bare `<pre class="mermaid">`. These snippets show Mermaid syntax only.

**Mind map** (indentation-based nesting):

```html
<pre class="mermaid">
mindmap
  root((Project))
    Frontend
      React
      Tailwind
    Backend
      Node.js
      PostgreSQL
</pre>
```

**C4 architecture (flowchart-as-C4):**

```html
<pre class="mermaid">
graph TD
  user("👤 User<br/><small>Browser client</small>")
  subgraph boundary["Web Platform"]
    app["Web App<br/><small>Node.js</small>"]
    db[("Database<br/><small>PostgreSQL</small>")]
  end
  email["📧 Email Service"]:::ext
  user -->|"HTTPS"| app
  app -->|"SQL"| db
  app -->|"SMTP"| email
  classDef ext fill:none,stroke-dasharray:5 5
</pre>
```

Do NOT use native `C4Context`/`C4Container` syntax — it hardcodes sharp corners, its own font, and inline colors that ignore `themeVariables`. Use `graph TD` + `subgraph` instead; it inherits all theme settings automatically.

### Which Mermaid Diagram Type?

| You want to show...                                | Use              | Syntax keyword                                   |
| -------------------------------------------------- | ---------------- | ------------------------------------------------ |
| Process flow, decisions, pipelines                 | Flowchart        | `graph TD` / `graph LR`                          |
| Request/response, API calls, temporal interactions | Sequence diagram | `sequenceDiagram`                                |
| Database tables and relationships                  | ER diagram       | `erDiagram`                                      |
| OOP classes, domain models with methods            | Class diagram    | `classDiagram`                                   |
| System architecture at multiple zoom levels        | C4 diagram       | `graph TD` + `subgraph` (not native `C4Context`) |
| State transitions, lifecycles                      | State diagram    | `stateDiagram-v2`                                |
| Hierarchical breakdowns, brainstorms               | Mind map         | `mindmap`                                        |

## Chart.js — Data Visualizations

Use for bar, line, pie/doughnut, and radar charts in dashboard-type diagrams. Overkill for static numbers — use pure SVG/CSS for progress bars and sparklines.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<canvas id="myChart" width="600" height="300"></canvas>
<script>
  const isDark = false; // light by default; opt into dark only when the user asks
  const textColor = isDark ? "#8b949e" : "#6b7280";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const fontFamily =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-body")
      .trim() || "system-ui, sans-serif";

  new Chart(document.getElementById("myChart"), {
    type: "bar",
    data: {
      labels: ["Jan", "Feb", "Mar"],
      datasets: [{ label: "Items", data: [45, 62, 78] }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: textColor, font: { family: fontFamily } } },
      },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor }, grid: { color: gridColor } },
      },
    },
  });
</script>
```

## Google Fonts — Typography

Load with `display=swap` and always provide fallbacks. Avoid Inter, Roboto, Arial/Helvetica, or bare `system-ui` as `--font-body` — they signal zero design intent.

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Outfit:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

```css
:root {
  --font-body: "Outfit", system-ui, sans-serif;
  --font-mono: "Space Mono", "SF Mono", Consolas, monospace;
}
```
