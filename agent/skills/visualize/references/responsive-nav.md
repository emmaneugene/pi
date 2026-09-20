# Responsive Section Navigation

Navigation for multi-section pages (reviews, recaps, dashboards): a sticky sidebar TOC on desktop, a sticky horizontal scroll bar on mobile.

## Layout Structure

Two-column CSS Grid: sidebar (TOC) + main content. On mobile it collapses to single-column with the TOC becoming a horizontal bar.

```html
<body>
  <div class="wrap">
    <nav class="toc" id="toc">
      <div class="toc-title">Contents</div>
      <a href="#s1">1. First Section</a>
      <a href="#s2">2. Second Section</a>
      <!-- one link per section -->
    </nav>

    <div class="main">
      <h1>Page Title</h1>
      <p class="subtitle">Subtitle text</p>

      <div id="s1" class="sec-head ...">1 — First Section</div>
      <!-- section content -->

      <div id="s2" class="sec-head ...">2 — Second Section</div>
      <!-- section content -->
    </div>
    <!-- /main -->
  </div>
  <!-- /wrap -->
</body>
```

Key structural rules: `<nav class="toc">` is the **first child** of `.wrap`; all content goes inside `<div class="main">`; every section heading gets `id="s1"`, `id="s2"`, etc. matching the TOC `href="#s1"` links; keep TOC link text short.

## CSS

### Wrap (grid layout)

```css
.wrap {
  max-width: 1400px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 0 40px;
}
.main {
  min-width: 0;
}
```

### TOC — Desktop (sticky sidebar)

```css
.toc {
  position: sticky;
  top: 24px;
  align-self: start;
  padding: 14px 0;
  grid-row: 1 / -1;
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
}
.toc::-webkit-scrollbar {
  width: 3px;
}
.toc::-webkit-scrollbar-thumb {
  background: var(--surface-elevated);
  border-radius: 2px;
}

.toc-title {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--text-dim);
  padding: 0 0 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.toc a {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 5px;
  border-left: 2px solid transparent;
  transition: all 0.15s;
  line-height: 1.4;
  margin-bottom: 1px;
}
.toc a:hover {
  color: var(--text);
  background: var(--surface2);
}
.toc a.active {
  color: var(--text);
  border-left-color: var(--accent);
}
```

Replace `var(--accent)` with the page's primary accent variable.

### TOC — Mobile (sticky horizontal bar)

```css
@media (max-width: 1000px) {
  .wrap {
    grid-template-columns: 1fr;
    padding-top: 0;
  }
  body {
    padding-top: 0;
  }

  .toc {
    position: sticky;
    top: 0;
    z-index: 200;
    max-height: none;
    display: flex;
    gap: 4px;
    align-items: center;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 10px 0;
    margin: 0 -40px;
    padding-left: 40px;
    padding-right: 40px;
    grid-row: auto;
  }
  .toc::-webkit-scrollbar {
    display: none;
  }
  .toc-title {
    display: none;
  }

  .toc a {
    white-space: nowrap;
    flex-shrink: 0;
    border-left: none;
    border-bottom: 2px solid transparent;
    border-radius: 4px 4px 0 0;
    padding: 6px 10px;
    font-size: 10px;
  }
  .toc a.active {
    border-left: none;
    border-bottom-color: var(--accent);
    background: var(--surface);
  }

  .main {
    padding-top: 20px;
  }

  /* Offset scroll target so headings clear the sticky bar */
  .sec-head {
    scroll-margin-top: 52px;
  }
}
```

Match `margin: 0 -40px` and `padding-left/right: 40px` to the page's `body` padding so the bar bleeds edge-to-edge.

## JavaScript — Scroll Spy

Place before `</body>`, after any Mermaid init:

```html
<script>
  (function () {
    const toc = document.getElementById("toc");
    const links = toc.querySelectorAll("a");
    const sections = [];

    links.forEach((link) => {
      const id = link.getAttribute("href").slice(1);
      const el = document.getElementById(id);
      if (el) sections.push({ id, el, link });
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            links.forEach((l) => l.classList.remove("active"));
            const match = sections.find((s) => s.el === entry.target);
            if (match) {
              match.link.classList.add("active");
              // On mobile, auto-scroll the active tab into view
              if (window.innerWidth <= 1000) {
                match.link.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                  inline: "center",
                });
              }
            }
          }
        });
      },
      { rootMargin: "-10% 0px -80% 0px" },
    );

    sections.forEach((s) => observer.observe(s.el));

    links.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const id = link.getAttribute("href").slice(1);
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          history.replaceState(null, "", "#" + id);
        }
      });
    });
  })();
</script>
```

## Adaptation Notes

`.toc-title` text, link labels, accent color, and section IDs change per page; everything else is copy-paste. Skip the TOC below 4 sections. `grid-template-columns: 170px 1fr` fits most TOCs; go up to `200px` for longer section names. `rootMargin: '-10% 0px -80% 0px'` marks a section active when its heading enters the top 10–20% of the viewport. On mobile, the active tab auto-scrolls to center as the page scrolls.
