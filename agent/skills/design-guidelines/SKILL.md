---
name: design-guidelines
description: Preferred approach to interface design, UI polish, and motion. Use when designing, implementing, or reviewing user interfaces, animations, gesture-driven interactions, springs, drag/swipe/sheet behavior, materials, typography, interaction feedback, reduced motion, or overall product craft.
source: adapted from https://github.com/emilkowalski/skills
---

# Design guidelines

Read `guidelines.md` in this skill's directory for the full rule set. Apply the guidance using the product's existing visual language, interaction conventions, platform constraints, and accessibility requirements.

## Authoring mode

When designing or implementing an interface:

1. Read `guidelines.md`.
2. Inspect the existing design system, components, motion conventions, and accessibility behavior.
3. Decide whether motion serves feedback, spatial consistency, explanation, or continuity. Remove motion that only delays frequent actions.
4. Choose the motion technique by interaction type: CSS transitions for predetermined state changes, velocity-aware springs for gesture-driven interactions, and keyframes for autonomous sequences.
5. Test interactive motion for interruption, input latency, reduced-motion behavior, and compositor performance.

## Review mode

When reviewing an interface or UI code:

1. Read `guidelines.md`.
2. Inspect the specified files and, when practical, exercise the interface rather than judging static code alone.
3. Check purpose and frequency first, then response, continuity, easing, duration, performance, accessibility, and cohesion.
4. Use a Markdown table with `Before`, `After`, and `Why` columns for findings.
5. Distinguish defects from subjective alternatives. Preserve deliberate choices that fit the product's character.

## Chat and inline suggestions

For focused design questions, apply the relevant principles without forcing a full audit. Give concrete values and techniques when the context supports them, and state when a recommendation requires testing by feel on the real interface.
