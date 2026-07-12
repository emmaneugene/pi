---
name: web-app-builder
description: Build interactive web apps as single-file HTML using React, Tailwind CSS, and shadcn/ui. Use when the user needs real interactivity - state management, routing, forms, data manipulation, component libraries. Not for static explanatory pages, diagrams, or reports (use visual-explainer for those).
source: https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder
---

# Web App Builder

To build powerful frontend artifacts, follow these steps:

1. Initialize the frontend repo using `scripts/init-artifact.sh`
2. Develop your artifact by editing the generated code
3. Bundle all code into a single HTML file using `scripts/bundle-artifact.sh`
4. Display artifact to user
5. (Optional) Test the artifact

**Stack**: React 18 + TypeScript + Vite + Parcel (bundling) + Tailwind CSS + shadcn/ui

**Boundary**: If the output is a static explanation, diagram, report, or slide deck with no meaningful app state, stop and use the `visual-explainer` skill instead - it needs no build step.

## Design & Style Guidelines

VERY IMPORTANT: To avoid what is often referred to as "AI slop":

- Pick a clear aesthetic direction before writing: editorial, paper/ink, terminal, IDE-inspired, blueprint, or data-dense.
- Default to a light-mode palette (light background/surface, dark text). Add dark mode only when asked.
- No body font that is only Inter, Roboto, Arial, Helvetica, or system-ui. Good pairs: DM Sans + Fira Code; IBM Plex Sans + IBM Plex Mono; Plus Jakarta Sans + Azeret Mono; Bricolage Grotesque + Fragment Mono.
- No violet/fuchsia Tailwind-default accents as the main palette (`#8b5cf6`, `#7c3aed`, `#a78bfa`, `#d946ef`); no cyan+magenta neon; no gradient-mesh blobs. Good accent directions: terracotta+sage, teal+slate, amber+emerald, deep blue+gold.
- Avoid excessive centered layouts and uniformly rounded corners.
- Respect `prefers-reduced-motion`; no continuous glow/pulse animation on static content.

## Quick Start

### Step 1: Initialize Project

Run the initialization script to create a new React project:

```bash
bash scripts/init-artifact.sh <project-name>
cd <project-name>
```

This creates a fully configured project with:

- ✅ React + TypeScript (via Vite)
- ✅ Tailwind CSS 3.4.1 with shadcn/ui theming system
- ✅ Path aliases (`@/`) configured
- ✅ 40+ shadcn/ui components pre-installed
- ✅ All Radix UI dependencies included
- ✅ Parcel configured for bundling (via .parcelrc)
- ✅ Node 18+ compatibility (auto-detects and pins Vite version)

### Step 2: Develop Your Artifact

To build the artifact, edit the generated files. See **Common Development Tasks** below for guidance.

### Step 3: Bundle to Single HTML File

To bundle the React app into a single HTML artifact:

```bash
bash scripts/bundle-artifact.sh
```

This creates `bundle.html` - a self-contained file with all JavaScript, CSS, and dependencies inlined.

**Requirements**: Your project must have an `index.html` in the root directory.

**What the script does**:

- Installs bundling dependencies (parcel, @parcel/config-default, parcel-resolver-tspaths, html-inline)
- Creates `.parcelrc` config with path alias support
- Builds with Parcel (no source maps)
- Inlines all assets into single HTML using html-inline

### Step 4: Deliver to User

Give the user the path to `bundle.html` so they can open it in a browser (e.g. `open bundle.html`).

### Step 5: Testing/Visualizing the Artifact (Optional)

Note: This is a completely optional step. Only perform if necessary or requested.

To test/visualize the artifact, use available tools (e.g. `dev-browser`). In general, avoid testing the artifact upfront as it adds latency between the request and when the finished artifact can be seen. Test later, after presenting the artifact, if requested or if issues arise.

## Reference

- **shadcn/ui components**: https://ui.shadcn.com/docs/components
