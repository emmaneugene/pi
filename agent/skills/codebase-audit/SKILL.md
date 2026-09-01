---
name: codebase-audit
description: Audit an entire codebase for materially useful simplifications in data structures, state representation, control flow, algorithms, and ownership. Use when the user asks for a full codebase audit, repository-wide simplification audit, subsystem-by-subsystem architecture review, or complete code quality assessment. This is a read-only audit that requires explicit coverage, evidence, risks, validation, and priorities.
source: https://gist.github.com/aarondfrancis/8735edbe48532f97ee5ea818db4dbd47
---

# Codebase Audit

Audit the entire codebase for materially useful simplifications in its data structures, state representation, control flow, algorithms, and ownership.

## Operating Rules

This is an audit-only exercise.

- Do not edit files.
- Do not run tests.
- Do not implement recommendations.
- Do not commit or push.
- Use read-only inspection commands only.
- Keep temporary audit state outside the repository. Use `$TMPDIR` when a file is necessary.
- Continue until the complete codebase has been reviewed and the final audit has been validated.

Act as the coordinator. Maintain one canonical audit record throughout the review.

## 1. Establish the Coverage Contract

Inspect the repository. Inventory every identifiable subsystem.

Give each subsystem:

- a stable ID and descriptive name;
- an exact ownership boundary;
- its key implementation files;
- relevant public interfaces, major call sites, and tests;
- a status: `queued`, `in review`, `recommend`, or `skip`.

Include these areas when they are materially relevant:

- frontend;
- backend;
- shared infrastructure;
- platform bridges;
- generated-contract ownership;
- test and tooling infrastructure.

Create one canonical audit record that contains:

- the subsystem inventory;
- confirmed opportunities;
- explicit skip decisions;
- cross-cutting patterns;
- duplicates and superseded findings;
- final priorities and dependencies;
- an audit log.

Treat the inventory as the coverage contract. Do not use broad catch-all rows as proof of coverage.

## 2. Run Bounded Subsystem Reviews

Use fresh, read-only subagents when they are available. Give each worker one distinct subsystem with an exact, non-overlapping ownership boundary.

Keep concurrency within the number of lanes that you can actively coordinate. Use one consolidated wait mechanism. Do not interrupt a productive worker only because it is slow. Harvest each completed result.

Give each worker this brief:

> Review the assigned subsystem for at most two materially useful simplifications in its data structures, state representation, control flow, algorithms, or organizing model.
>
> Inspect its implementation, public interfaces, major call sites, and existing tests. Stay inside the assigned ownership boundary. You can identify cross-subsystem concerns, but do not expand the scope to solve them.
>
> Do not edit files or run tests. Use read-only inspection commands only.

Ask the worker to look for:

- scattered booleans or nullable fields that permit invalid combinations and should become a state machine or discriminated union;
- repeated assumptions about object shape that need a shared typed model;
- duplicated branching that a small map, registry, reducer, or command model would remove;
- unclear state or behavior ownership that a small module boundary would clarify;
- repeated scans, transformations, or lookups where a more suitable collection or index would materially simplify behavior;
- lifecycle, concurrency, or asynchronous states whose representation permits stale or contradictory state.

Do not force an abstraction. Prefer boring local code when it is already clear.

Do not recommend a change only for:

- stylistic consistency;
- hypothetical extensibility;
- minor line-count reduction;
- moving existing branching behind a new type.

Each worker must return at most two opportunities. The worker must return `skip` when nothing clearly meets the threshold.

Require this schema for each result:

1. **Verdict:** `recommend` or `skip`.
2. **Evidence:** Exact file and line references.
3. **Current complexity:** Explain the complexity or invalid states.
4. **Proposed representation:** Explain the simpler model and why it is simpler.
5. **Smallest credible scope:** List affected files and interfaces.
6. **Risks:** State regression risks and migration concerns.
7. **Validation:** List existing and additional validation that implementation would require.
8. **Confidence:** `high`, `medium`, or `low`.

## 3. Validate and Synthesize

Independently verify every finding against the current repository before you accept it.

Reject, narrow, or demote a recommendation when it:

- is vague;
- duplicates another finding;
- misunderstands intentional semantics;
- only relocates complexity;
- does not have sufficient evidence.

Record each `skip` as completed coverage. Deduplicate overlapping findings. Assign each accepted recommendation to one authoritative subsystem.

Continue bounded review batches until every inventory row is complete.

## 4. Audit the Audit

Before you finish, run fresh independent passes for:

- repository coverage and missing subsystem boundaries;
- duplication and ownership overlap;
- materiality and over-abstraction;
- result-schema completeness;
- dependency-aware priority ranking.

If the coverage pass finds a real omission, add an explicit subsystem row and audit it. Do not hide the omission by broadening a completed boundary.

Rank final recommendations by:

- concrete impact;
- confidence;
- implementation effort;
- blast radius;
- prerequisites.

Identify the best first implementation slices.

## Completion Criteria

The audit is complete only when:

- every identifiable subsystem has been reviewed;
- every subsystem has a recommendation or explicit skip;
- every finding includes complete evidence, scope, risk, validation, and confidence fields;
- duplicate findings and weak abstractions have been removed;
- priorities and dependencies are internally consistent;
- the repository remains unchanged.

## Final Report

Lead with the highest-priority accepted recommendations. For each recommendation, include its subsystem ID and the complete result schema.

Then include:

1. the ranked recommendation list and best first implementation slices;
2. cross-cutting patterns;
3. the complete subsystem coverage table, including skips;
4. rejected, merged, or superseded findings;
5. coverage and validation limitations;
6. confirmation that the repository remained unchanged.

Prefer a small number of well-supported recommendations over many weak suggestions. State clearly when a subsystem does not contain a material simplification opportunity.
