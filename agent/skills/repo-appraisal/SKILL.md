---
name: repo-appraisal
description: "Appraise a project from git history - churn hotspots, contributor concentration, bug clusters, velocity trend, and firefighting frequency. Use when asked to appraise, audit, or assess the risk profile of a git-backed codebase, especially before reading much code."
---

# Repo Appraisal

Use this skill for a first-pass appraisal of a repository from git history alone. The goal is to give the users a starting point to identify where change is risky, where knowledge is concentrated, whether bugs cluster in specific files, whether delivery has momentum, and whether the team appears to be firefighting.

## Workflow

1. Treat this as a git-history-first appraisal. Start here before deep code reading unless the user asks for a fuller audit.
2. Confirm you are running from the repo root (`git rev-parse --show-toplevel`). If the cwd is a subdirectory, switch to the root first so name-only commands return repo-relative paths consistently.
3. Run the commands below against the repository.
4. Keep the top 10-20 results from the churn and bug-cluster commands.
5. Note files that appear in both the churn and bug-cluster lists — these are usually the highest-risk parts of the codebase.
6. Compare all-time authorship with the last 6 months. Flag concentrated ownership and likely knowledge loss.
7. Read commit velocity for shape, not just counts: steady, accelerating, declining, or bursty.
8. Use revert/hotfix frequency as a signal for deploy confidence and operational stress.
9. If a command returns little or no signal, say that explicitly and lower confidence rather than forcing a conclusion.
10. Summarise findings in whatever form fits the signal. Prefer a few strong observations over a wall of weak ones.

## Commands

### 1. Churn Hotspots

```bash
git log --format=format: --name-only --since="1 year ago" \
  | sed '/^$/d' | sort | uniq -c | sort -nr | head -20
```

If the output is dominated by generated or vendored files (lockfiles, `vendor/`, `dist/`, snapshots), rerun with a noise filter and note that you did so:

```bash
git log --format=format: --name-only --since="1 year ago" \
  | sed '/^$/d' \
  | grep -vE '(package-lock\.json|yarn\.lock|\.lock$|vendor/|dist/|generated/)' \
  | sort | uniq -c | sort -nr | head -20
```

How to read it:

- High churn does not automatically mean bad code; it can also mean active development.
- High churn on files people are hesitant to touch is a strong risk signal.
- Carry the top files forward into the summary, especially if they also appear in bug clusters.
- If the repo is younger than a year, say so and treat the output as "available history" rather than a full-year sample.

### 2. Contributor Map / Bus Factor

```bash
git shortlog -sn --no-merges HEAD
git shortlog -sn --no-merges --since="6 months ago" HEAD
```

How to read it:

- If one contributor dominates the commit count, flag bus-factor risk.
- If the top all-time contributor is absent from the 6-month view, call out likely context loss.
- Look at the tail too: many historical contributors with only a few recent maintainers can mean the builders and maintainers are no longer the same people.
- Treat this as a heuristic, not a precise ownership model.

### 3. Bug Clusters

```bash
git log -i -E --grep='fix|bug|broken' --name-only --format='' \
  | sed '/^$/d' | sort | uniq -c | sort -nr | head -20
```

How to read it:

- This is a rough map of where bug-related commits cluster.
- Files appearing in both the churn list and this list are usually the highest-risk code in the codebase.
- Sparse or empty output does not prove low bug volume; it may just mean poor commit-message discipline.
- If the repo uses different wording, note that the keyword filter may undercount bug work.

### 4. Velocity Trend

```bash
git log --format='%ad' --date=format:'%Y-%m' | sort | uniq -c
```

For repos with long histories (10+ years), the full output can be very long. Scope to recent years if readability suffers:

```bash
git log --since="3 years ago" --format='%ad' --date=format:'%Y-%m' | sort | uniq -c
```

How to read it:

- Scan for shape, not absolute numbers.
- A steady rhythm suggests consistent delivery.
- A declining curve can suggest lost momentum or reduced staffing.
- Spikes followed by quiet periods can suggest release batching or crunch-driven delivery.
- Sudden drops or jumps are worth calling out as team or process signals.

### 5. Co-change Coupling

Files that change together frequently are implicitly coupled — a useful signal for hidden dependencies and blast radius.

```bash
git log --name-only --format='COMMIT' --since="1 year ago" | python3 -c "
import sys
from collections import defaultdict
pairs = defaultdict(int)
current = []
for line in sys.stdin:
    line = line.strip()
    if line == 'COMMIT':
        if len(current) > 1:
            files = sorted(set(current))
            for i in range(len(files)):
                for j in range(i+1, len(files)):
                    pairs[(files[i], files[j])] += 1
        current = []
    elif line:
        current.append(line)
for (a, b), count in sorted(pairs.items(), key=lambda x: -x[1])[:20]:
    print(f'{count:4d}  {a}  <->  {b}')
"
```

How to read it:

- High co-change between logically unrelated files suggests hidden coupling or missing abstractions.
- Co-change within a module is expected; co-change across module boundaries is the interesting signal.
- Pairs involving high-churn or high-bug files compound risk.
- In monorepos, filter by path prefix to keep results meaningful.

### 6. Crisis Frequency

```bash
git log --oneline --since="1 year ago" \
  | grep -iE 'revert|hotfix|emergency|rollback' || true
```

How to read it:

- A few reverts or hotfixes in a year is normal.
- Frequent crisis-language commits suggest low deploy confidence, weak tests, or operational instability.
- Zero results is ambiguous: it can mean stability, or just non-descriptive commit messages.
- Mention the ambiguity instead of overclaiming.

## Caveats

- **Squash merges**: shortlog may reflect who merged PRs, not who authored them.
- **Commit message quality**: bug and crisis commands are only as good as the repo's commit-message discipline.
- **Young repos / shallow history**: 1-year and 6-month windows may be misleading if the repo is new or history is incomplete.
- **Generated or mechanical churn**: lockfiles, snapshots, vendored code, or generated artifacts can dominate churn without indicating design risk. Call this out if you see it.
- **Monorepos**: churn leaders may reflect the busiest product area rather than the riskiest subsystem. Keep interpretation grounded.

## Output

No fixed structure is required. Summarise what the data actually shows in whatever form is clearest. Prefer a few strong findings over a wall of weak observations. Always note when a signal had low quality.
