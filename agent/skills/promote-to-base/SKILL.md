---
name: promote-to-base
description: Land the current working branch's uncommitted changes onto its base branch and rebase. Use when the user asks to commit current changes to the base branch (main, or a custom name), push, and rebase the current branch off it. Assumes the base branch is checked out in a separate worktree. The user validates the diff and signs off on the commit message before committing.
disable-model-invocation: true
---

# Promote to base

Move the current uncommitted work from the working branch onto the base branch
(checked out in a separate worktree), push, then rebase the working branch onto
the new base.

Nothing is hardcoded. The repo root, current branch, base branch, and base
worktree are all derived from git:

- `$REPO` — repo root of the current checkout
- `$BRANCH` — current branch. **If it is already `$BASE`, do nothing.**
- `$BASE` — the branch to land on. Take it from the user's request when given.
  Otherwise resolve in this order: `main` when it exists locally; else the
  only other local branch checked out in a worktree. Ask the user when the
  candidates are ambiguous (multiple worktrees, no main, no other worktree).
- `$BASE_WT` — path of the worktree that has `$BASE` checked out. This flow
  requires `$BASE` to live in its own worktree; abort if none is found.

The user's job: **validate the staged diff and sign off on the commit message.**
Do not commit until they approve.

## Preconditions (verify first, abort if any fail)

```bash
REPO="$(git rev-parse --show-toplevel)" && cd "$REPO"
BRANCH="$(git branch --show-current)"
[ "$BRANCH" = "$BASE" ] && { echo "already on $BASE; nothing to promote"; exit 0; }
BASE_WT="$(git worktree list --porcelain | awk -v b="refs/heads/$BASE" '/^worktree /{wt=$2} $0 == "branch " b{print wt; exit}')"
[ -z "$BASE_WT" ] && { echo "no worktree has $BASE checked out; abort"; exit 1; }
git log --oneline "$BASE..$BRANCH"                 # branch = base + config commit(s) only
git diff --name-only "$BASE" "$BRANCH"             # confirm branch-only commits DON'T touch the files being promoted
git -C "$BASE_WT" status --short                   # base worktree must be clean
git fetch origin "$BASE" --quiet
git rev-parse "$BASE" "origin/$BASE"               # must be equal (clean fast-forward push)
```

`$REPO`, `$BRANCH`, `$BASE`, and `$BASE_WT` are set here; re-derive them at the
start of any later step that runs in a fresh shell.

## 1. Stash the batch

Stash the uncommitted work so both the working branch and the base worktree are
clean for the rebase. **Do not** use `git stash push -- <pathspec>` when the
batch includes a deleted file — the pathspec fails to match a deleted path and
leaves a partial stash.

```bash
git stash push -u -m "<batch label>"               # -u also captures new + deleted files
git status --short                                  # expect clean
git stash list                                      # 0 = batch
```

If untracked paths exist that should stay behind, don't use `-u`; stash the batch
by explicit pathspec instead (only safe when the batch has no deleted files).

## 2. Apply + review + commit in the base worktree

```bash
cd "$BASE_WT"
git stash apply stash@{0}                           # the batch
git add -A                                          # stages modifications, adds, and deletions
git status --short                                  # confirm exactly the intended files
git diff --cached                                   # <- show this to the user
```

Present the staged diff and a proposed commit message. **Wait for sign-off.**
Then commit with the approved message and push:

```bash
git commit -F - <<'MSG'
<approved message>
MSG
git show --stat --oneline HEAD                      # confirm exactly the intended files
git push origin "$BASE"
git rev-parse "$BASE" "origin/$BASE"                # confirm equal
git stash drop stash@{0}                            # batch consumed
```

## 3. Rebase the working branch

```bash
cd "$REPO"
BRANCH="$(git branch --show-current)"
git rebase "$BASE"                                  # tree is clean (stashed); replays config commit(s)
git status --short                                  # expect clean
```

## Aftermath

`$BRANCH` now diverges from `origin/$BRANCH` (rewritten by rebase). Do **not**
push it unless asked; it requires `git push --force-with-lease origin "$BRANCH"`.
Mention this.
