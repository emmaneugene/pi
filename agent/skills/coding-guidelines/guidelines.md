# Coding Guidelines

How to design and write code in this codebase. These rules are language-agnostic; apply each one using the idioms of the language and ecosystem in front of you. Core principles outrank mechanical rules. In review mode, a core-principle violation is a bigger finding than a mechanical one.

## Decision priority

When rules pull in different directions, use this order:

1. Preserve correctness, safety, and debuggability.
2. Follow established project architecture and conventions.
3. Improve the local design toward these standards.
4. Avoid broad migrations unless explicitly requested.
5. Document meaningful trade-offs with comments or ADRs.

When work includes both a fix and a refactor, choose the order that keeps the fix straightforward. If refactoring would make the fix harder, complete the fix first.

Before adding a new pattern or library, inspect the repo for existing choices around error handling, schema parsing, dependency injection, testing, observability, adapters, and module layout. If existing code uses exception-style errors, do not rewrite the whole system: new code may use typed results internally, but it must integrate with the existing framework handlers, logging, tracing, and error reporting. At boundaries, translate between local typed errors and whatever the framework expects. Do not force a whole-project migration for an unrelated change.

## Core principles

- Prefer errors as values over throwing or rejecting for expected failures.
- Parse early. Do not validate and then discard what you learned.
- Make illegal states unrepresentable where practical.
- Prefer correct-by-construction APIs over convention-based invariants.
- Use domain types for meaningful primitives instead of raw strings and numbers.
- Prefer composition over inheritance.
- Prefer a functional core with an imperative shell.
- Design deep, cohesive modules with low caller burden.
- Test behavior through real seams; avoid module mocks and spy-driven tests.
- Keep code discoverable for humans and agents.

## Errors and failures

### Expected failures are values

Expected failures include domain, parsing, authorization, integration, I/O, persistence, and workflow failures. They should appear in the return type, not travel through the throw/reject channel.

Prefer a function that returns "a user or a lookup error" over one that returns a user and rejects for ordinary lookup or storage failures. Rejection is equivalent to throwing: treat it as acceptable only for unrecoverable defects or unclassified third-party behavior at a boundary.

Use the project's established result type if one exists; otherwise a small tagged union or the language's idiomatic equivalent (a sum type, a result/either type, a checked value-and-error tuple).

Keep error unions precise at module boundaries. A password-reset lookup returns `UserNotFound | UserStoreUnavailable`, not a broad app-wide error type. Reserve broad error types for entrypoints, orchestration, logging, and rendering layers.

### Unrecoverable defects may throw

Throwing is acceptable for panic-style failures:

- violated internal invariants
- impossible branches
- startup misconfiguration
- temporary not-yet-implemented paths
- catastrophic runtime conditions

Use shared panic and exhaustiveness helpers where the project has them (an exhaustive-case guard, a should-never-happen guard, a not-yet-implemented guard). Reuse the project's helpers instead of inventing one-off equivalents.

### Custom errors

Expected failures should use custom tagged errors carrying:

- a stable tag
- a useful message
- structured contextual fields (domain IDs, operation, provider)
- safe telemetry fields
- an optional cause

## Sensitive data, telemetry, and debugging

Prefer end-to-end structured tracing across requests, jobs, workflows, modules, adapters, and external calls. Tracing and logging should make failures diagnosable with safe fields: domain IDs, operation names, dependency and provider names, state tags, retry counts, typed error tags, and safe summaries.

Do not put secrets in errors, traces, logs, or snapshots. Wrap sensitive values (tokens, API keys, passwords, raw credentials) in a redaction wrapper at the boundary and unwrap only where the raw value is needed, usually inside the adapter making the external call.

## Parse, don't validate

Boundary code should turn unknown or less-structured input into domain types as early as practical, then pass domain types (not raw DTOs) through the rest of the system.

Flow: `unknown -> transport DTO -> domain input -> domain value types`. Do not pass an inferred schema shape throughout the app.

Use names that preserve meaning:

- `parseX(input): Result<X, ParseXError>` for untrusted or less-structured input
- `makeX(...)` / `createX(...)` for smart constructors from already-typed pieces
- `isX(value): boolean` for true predicates
- `assertX(...)` rarely, mostly at test and framework boundaries

Avoid `validateX` when the function returns a refined value: it parsed something, so name it for what it produces. Use a schema library as a boundary parser that produces refined domain types and typed errors, not as an ad-hoc validator sprinkled through core logic.

## Correct construction

Use domain types for meaningful primitives: IDs (`UserId`, `OrgId`), parsed strings (`EmailAddress`, `Url`), constrained numbers (`PositiveInt`, `Cents`), and units (`Milliseconds`, `Bytes`). Construct them through parsers or smart constructors; avoid passing raw strings and numbers where a domain type exists.

Avoid optional, null, or undefined values in functions that require a value. Push optionality outward: branch or parse before calling. Avoid partial-input types as application or domain input unless partiality is the real domain concept; prefer an explicit input type per operation.

## Bounded execution and resource use

Put explicit limits on work and resource consumption where unbounded growth could threaten safety, latency, or availability. Bound queues, retries, batches, payloads, recursion depth, concurrency, in-memory collections, and work performed per interval. Reject or assert violations at the boundary; do not rely on an expectation that production inputs will remain small.

Prefer simple, explicit control flow where correctness depends on understanding every path. Avoid unbounded recursion. Use iteration or an explicitly bounded depth when input or runtime state controls traversal.

Decouple ingestion from processing when external events could dictate the program's pace. Buffer within a fixed bound, apply backpressure or reject excess work, and process controlled batches. This keeps scheduling under the application's control and amortizes fixed costs without hiding overload.

## Assertions and executable invariants

Use assertions for programmer errors: violated preconditions, postconditions, internal invariants, impossible states, and relationships the type system cannot express. Do not use assertions for malformed input, unavailable dependencies, or other expected operating failures; return those as typed values.

Place assertions where they improve defect detection and diagnosis:

- assert important assumptions at function and module boundaries
- pair critical assertions across independent paths, such as before serialization and after parsing
- assert both the positive space that is allowed and the negative space that must remain impossible
- split unrelated compound assertions so a failure identifies the violated property
- use compile-time assertions for constant relationships, layouts, capacities, and type sizes where the language supports them

Assertions supplement types, parsing, tests, and review. They do not replace a precise mental model of the code.

## State machines and boolean blindness

When an entity has meaningful lifecycle states, model them with tagged unions or equivalent value types, one variant per state carrying exactly the fields that state has.

Prefer a `Draft | Sent | Paid` union where each variant carries its own timestamps over a single record with `isSent`, `isPaid`, `sentAt?`, `paidAt?` flags that can drift into illegal combinations.

Avoid boolean parameters that control behavior:

```
createUser(input, true)
```

Prefer named options or domain types:

```
createUser(input, { emailVerification: "skip" })
```

Booleans are fine as clear predicate return values: `isExpired(token)`, `hasPermission(user, permission)`.

## Modules and abstractions

### Deep modules

A deep module hides substantial behavior and invariants behind a cohesive, low-burden interface. Low-burden does not mean few functions: a domain module may expose many cohesive combinators around one concept and still be deep.

Avoid shallow abstractions that merely forward calls, mirror tables, or expose implementation steps. Use the deletion test:

- if deleting the module makes complexity disappear, it was pass-through waste
- if deleting it spreads complexity across callers, it was earning its keep

### Domain modules

Prefer domain modules for core concepts. A domain module centers on one primary type or tightly related family and exposes parsers, smart constructors, combinators, predicates, interpreters, and formatting helpers for that concept.

If a domain value is a class, construct it through `parse` / `make` / smart constructors, make invalid instances unconstructable, keep fields immutable from callers, keep methods cohesive over that value, do not hide dependencies or I/O inside it, and avoid inheritance for its behavior.

### Application and service modules

Application modules own real capabilities: `PasswordReset`, `Billing`, `Invitations`, `SubscriptionLifecycle`. They coordinate domain modules, persistence, external calls, authorization, workflows, and telemetry.

Prefer constructor injection when a module has dependencies, stateful resources, configuration, or multiple cohesive operations. Avoid dependency bags passed into every function.

No arbitrary method limit. Split when methods are unrelated, change for different reasons, need unrelated dependencies, or form an accidental grab bag. Avoid vague names like `Manager`, `Processor`, `Helper`, or a generic `UserService` unless the framework or project established them.

## Dependency interfaces and adapters

Depend on the smallest meaningful shape a module actually uses; let concrete adapters be wider. A `PasswordReset` that only calls `findActiveByEmail` should depend on a one-method shape, which a wide `PostgresUsers` adapter satisfies. This avoids both mega-repositories and one-method adapter sprawl.

### Adapter reuse audit

Before creating a new adapter or service, audit existing ones. Prefer, in order:

1. Reuse an existing adapter as-is through a narrow dependency type.
2. Extend an existing adapter if the new method fits its cohesive capability and changes for the same reason.
3. Create a new adapter only when reuse or extension would create bad coupling or an accidental interface.

When a meaningful new adapter or service is still created after the audit, write an ADR recording what was checked, why reuse did not fit, why extension did not fit, and why the new adapter is a separate cohesive capability. Skip the ADR for tiny test adapters, in-memory fakes, or trivial framework glue.

### Repositories and persistence

Avoid repository-per-table by default. Repository-like adapters are acceptable when they represent a cohesive domain persistence capability, exposing meaningful domain operations that return parsed domain types and typed errors, not raw rows and ORM errors.

Treat raw database rows and ORM models as infrastructure DTOs. Parse them before application or core logic, and keep SQL/ORM details inside infrastructure adapters.

## Functional core, imperative shell, entrypoints

Keep domain and application behavior reusable across REST, CLI, GraphQL, workers, and other entrypoints.

The functional core contains domain logic, parsers, state transitions, combinators, and decision functions. It avoids I/O, hidden dependencies, ambient time and randomness, thrown expected failures, and framework-specific concerns.

The imperative shell parses untrusted input, sequences effects, calls the core with refined values, classifies external failures into typed errors, and handles I/O, persistence, HTTP, queues, telemetry, time, and randomness.

Entrypoint adapters are thin protocol-translation layers: parse protocol-specific input, invoke shared modules, render protocol-specific output. Do not duplicate business rules in controllers, resolvers, or CLI handlers.

Authorization belongs in shared application or domain policy, not duplicated in controllers. Entrypoints may authenticate and parse users, sessions, and credentials, but shared modules should receive a parsed authorization input such as `AdminUser`, `Session`, or `Principal`.

## Performance design

Consider performance during design, before implementation makes the architecture expensive to change. Use back-of-the-envelope estimates to find order-of-magnitude constraints; use measurement and profiling to refine an implemented system, not to replace initial reasoning.

Estimate the four major resources: network, disk, memory, and CPU. For each, consider both latency and bandwidth, then multiply cost by expected frequency. Optimize the dominant total cost rather than assuming the nominally slowest resource is the bottleneck.

Batch work when it amortizes network round trips, storage operations, allocation, synchronization, or CPU overhead without violating latency or memory bounds. Separate high-volume data-plane work from lower-volume control-plane decisions when that distinction makes safety checks, batching, and capacity limits clearer.

Keep hot paths predictable and explicit. Avoid redundant computation and hidden allocation inside hot loops. Extract a hot loop behind a small interface when doing so makes inputs, mutation, and compiler behavior easier to inspect. Confirm performance-sensitive choices with representative benchmarks or profiles once the code exists.

## Workflows, transactions, idempotency

Use ordinary function calls or database transactions for simple single-boundary operations. Use a saga or durable workflow when the process needs retries, compensation, idempotency, resumability, timers, human approval, cross-service coordination, or multiple transaction boundaries.

Do not hold database transactions open across network calls or long-running operations.

Any command, job, or workflow step that may be retried needs an explicit idempotency strategy: an idempotency key, a natural unique constraint, a deduplication record, a state-machine transition guard, or a transactional outbox/inbox. Retrying must not rely on probably-safe side effects.

## Testing

Prefer confidence-oriented tests, in this order:

1. end-to-end for critical user flows
2. integration tests through real seams
3. focused and property tests for pure domain modules
4. unit tests when they assert meaningful behavior, not implementation details

Never mock modules or monkeypatch imports. Use real seams: constructor-injected interfaces, dependency-injection layers, local database substitutes (such as SQLite), in-memory adapters when behavior is simple, and fake external adapters when needed.

Assert observable behavior: the returned value or error, persisted state, an emitted event or message, a rendered response, or a sent-email record in a fake adapter. Avoid spy-driven assertions like "was this function called with these arguments" unless the interaction itself is the only observable behavior. For persistence behavior, prefer a local DB-backed test over a hand-rolled fake when SQL, schema, or transaction behavior matters.

Use property tests where properties are clearer than examples: parsers and smart constructors, domain types, state machines, serialization roundtrips, normalization and idempotence, and lawful combinators. Generate test data through the same parsers and smart constructors as production; tests should not bypass invariants.

Test both sides of every important boundary: valid values, invalid values, and transitions where valid state becomes invalid. Exercise expected error-handling paths directly; a failure path that only compiles has not been tested. For stateful systems, test invariant preservation across sequences, retries, interruption, and recovery.

## Files, naming, comments

Avoid vague files: `utils`, `helpers`, `common`, `misc`. Use precise names that describe content: `email-address`, `billing-period`, `string-case`. A single tiny module of ubiquitous generic helpers is fine; do not put domain or application policy in it.

No arbitrary file-size limits. Prefer cohesion and discoverability over small files for their own sake. Split when a file has multiple unrelated reasons to change or forces callers to understand unrelated concepts.

Comments should explain invariants, trade-offs, non-obvious domain rules, and safety justifications. Avoid comments that narrate obvious code. Document exported symbols so a caller can use them without reading the body.

Keep checks, calculations, and declarations close to where their result is used. Avoid aliases or duplicate representations of mutable state that can drift apart. Minimize the time and code between checking a property and relying on it.

Treat indexes, counts, sizes, offsets, and units as distinct concepts even when the language represents them with the same primitive type. Encode the distinction in domain types where practical and otherwise in precise names. Make conversions explicit, and state whether division must be exact, rounded down, or rounded up.

Prefer positive conditions and simple branches when they make the valid and invalid spaces easier to verify. Decompose dense boolean expressions when separate branches expose cases or invariants more clearly. Do not expand a clear predicate mechanically; optimize for reviewable control flow.

## Configuration and resources

Parse environment and config at startup or the earliest boundary into a typed config with domain and redacted values where appropriate. Do not read environment variables throughout the app. Missing or invalid config is a startup failure with useful context.

Avoid top-level side effects except in true entrypoint and bootstrap files. Modules should not start servers, open connections, read env, register handlers, or perform I/O at import time. Resource creation and cleanup should be explicit and owned by bootstrap or imperative-shell code.

Pass correctness-, durability-, security-, and performance-sensitive options explicitly at library call sites. Rely on defaults only when they are stable, inconsequential, and already established by the surrounding code.

Enable the strictest practical compiler and static-analysis diagnostics for the project, and treat actionable warnings as failures. Do not suppress a diagnostic without documenting why the code is safe or why the rule does not apply.

Avoid mutable singletons and global state; constants and pure lookup tables are fine. Inject clock and randomness into dependency-bearing modules; pure domain functions may take an explicit `now` or random value.

When code exposes raw buffers, serialized records, native layouts, cryptographic material, or foreign-function interfaces, initialize the full region that may be observed. Clear unused bytes and padding where they could leak sensitive data or break deterministic output. Test encoded lengths and buffer boundaries, including partially filled buffers.

## Review output format

Group by file. Use `file:line` format (editor-clickable). Terse findings: state issue plus location, skip explanation unless the fix is non-obvious. No preamble. Lead with core-principle findings, then mechanical.

```text
## src/password-reset.ts

src/password-reset.ts:14 - throws on user-not-found; expected failure, return typed error
src/password-reset.ts:31 - boolean param controls behavior; use named option
src/password-reset.ts:48 - depends on wide PostgresUsers; narrow to the shape used
src/password-reset.ts:60 - exported function has no doc comment

## src/email-address.ts

✓ pass
```
