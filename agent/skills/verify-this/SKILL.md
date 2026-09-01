---
name: verify-this
description: Verify a behavioral, UI, CLI, API, performance, or memory claim with fresh local evidence. Use when asked to verify, prove a fix works, compare before and after, or show evidence beyond passing tests.
source: https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/verify-this
---

# Verify this

Verification proves or disproves one falsifiable claim. It is not a recap of implementation work.

## Define the claim

State the claim as a condition, observable result or metric, and threshold. Infer these from the request and repository when they are clear. Ask only when ambiguity would change the verdict.

Do not force subjective claims such as "the code is cleaner" into this workflow. Review those against named criteria instead.

## Choose the proof surface

Use the smallest local surface that can disprove the claim:

- **Code behavior**: focused test or minimal script through the real public seam
- **Web or Electron UI**: `dev-browser`, `cdp`, or the repository's browser harness
- **Interactive CLI or TUI**: `agent-tmux` or the repository's PTY harness
- **API or service**: local request and response plus observable side effects
- **Performance**: same-machine timings or profiles with fixed inputs and warmup
- **Memory**: comparable snapshots before and after the named operation

Prefer an existing repository harness. Do not install a dependency to create a new one without permission.

## Capture comparable evidence

1. Record the exact claim and proof command or interaction
2. Capture a valid baseline from the current broken state, a failing test, or an isolated old revision
3. Capture the treatment with the same command, data, environment, viewport, warmup, and sample count
4. Compare raw artifacts rather than summaries
5. Check visible output and durable side effects when both matter

Never reset, switch, or overwrite the active checkout to obtain a baseline. Prefer a reproduction before editing. If historical code is required, use an isolated temporary worktree when it will not require unsafe setup; otherwise mark the missing baseline as a limitation.

A passing test is sufficient only when the claim concerns that test's contract. User-visible claims require evidence from the real user surface.

## Store artifacts safely

Keep private, short-lived evidence under `$TMPDIR/verify-this/<claim-slug>/`. Use `$PWD/tmp/verify-this/<claim-slug>/` only when the user should inspect or retain it.

Use this layout when it helps:

```text
claim.md
baseline/
treatment/
diff/
verdict.md
```

Do not persist credentials, customer data, private prompts, sensitive screenshots, response bodies, profiles, or heap snapshots. Keep only the minimal inline evidence when safe storage is uncertain.

Clean up processes, temporary worktrees, profiles, and scratch state created by the verification. Preserve user-requested evidence.

## Return one verdict

- `VERIFIED`: valid evidence meets the stated condition and threshold with no material confound
- `NOT VERIFIED`: behavior is unchanged, moves in the wrong direction, or misses the threshold
- `INCONCLUSIVE`: the baseline is invalid or absent, measurements are noisy, the environment differs, or the proof surface failed

Do not soften or upgrade the verdict. State untested parts explicitly.

Use this output:

```text
VERIFIED | NOT VERIFIED | INCONCLUSIVE
Claim: <falsifiable claim>

Evidence:
- <artifact or metric>: baseline=<value>, treatment=<value>, delta=<value>, threshold=<value>

Limitations:
- <material confound or untested part, or "None">
```
