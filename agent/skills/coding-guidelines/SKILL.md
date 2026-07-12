---
name: coding-guidelines
description: Preferred approach to designing and writing code. Use when authoring or refactoring non-trivial code (new modules, services, adapters, error handling, domain types) and when asked to review code against these standards ("review this diff", "does this follow our standards", "critique this design").
source: adapted from https://gist.github.com/dmmulroy/9c80f1f499b031aa0b6525b5d9ae25f0 and https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md
---

# Coding Guidelines

Read `guidelines.md` (in this skill's directory) for the full rule set. It is language-agnostic; apply each principle using the idioms of the language and ecosystem you are working in.

These standards describe how to design code, not just format it. Before adding patterns, libraries, adapters, or abstractions, read the existing code and prefer the local convention unless it conflicts with the safety and correctness principles in `guidelines.md`.

## Authoring mode

When writing or refactoring code:

1. Read `guidelines.md`.
2. Audit the existing codebase for its conventions around errors, schema parsing, dependency injection, testing, observability, adapters, and module layout. Consistency inside the repo outranks these standards.
3. Apply the decision priority: correctness and debuggability first, then existing project conventions, then improving the local design toward these standards. Do not force a whole-project migration for an unrelated change.
4. Follow the core principles. The mechanical rules are the floor; correct-by-construction design is the goal.

## Review mode

When asked to review or critique code against these standards:

1. Read `guidelines.md`.
2. Read the specified files or diff (or ask which to review).
3. Check against core principles first, then mechanical rules. A core-principle violation (throwing on expected failures, boolean blindness, shallow pass-through modules, module-mock tests) is a bigger finding than a style nit.
4. Judge new code against the standards; judge existing untouched code against the repo's own conventions. Flag a standards deviation in new code, not a pre-existing pattern the change merely sits next to.
5. Output findings in the terse `file:line` format specified at the end of `guidelines.md`.

## Chat and inline suggestions

Quick code answers in chat follow the core principles (errors as values, parse don't validate, no boolean blindness) without demanding the full ceremony (ADRs, exhaustive JSDoc). Apply the full standard when producing durable code in the repo.
