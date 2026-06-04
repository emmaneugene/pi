---
name: pi-spawn-subagents
description: "Spawn lightweight pi subagents by invoking `pi -p` from bash. Use when decomposing work into independent reviews, investigations, plans, or implementations without the pi-subagents extension."
---

# Pi Spawn Subagents

Use this skill when the task benefits from one or more independent child agents. This skill does not add a custom tool; it teaches the model to use the existing `bash` tool to run `pi -p` as a subagent.

## Core pattern

Run child agents with `pi --no-session -p <prompt>` from the current working directory. Prefer `--no-session` for disposable children so they do not clutter session history.

For non-trivial prompts, write the prompt to a temporary file first to avoid quoting issues:

```bash
prompt_file="$TMPDIR/pi-subagent-review.md"
cat > "$prompt_file" <<'EOF'
You are a focused subagent.

Task: Review the repository for risky auth-related code.

Constraints:
- Do not edit files.
- Cite file paths and commands used.
- Return concise findings and confidence.
EOF

pi --no-session -p "$(cat "$prompt_file")"
```

## When to spawn subagents

Spawn subagents for:

- independent code reviews or design critiques
- parallel investigations across different files or hypotheses
- second opinions before risky edits
- generating plans that the parent agent will verify and execute
- summarizing large areas while the parent remains in control

Do not spawn subagents for tiny questions where direct inspection is faster.

## Parent responsibilities

The parent agent remains responsible for correctness.

1. Give each child a narrow, explicit task.
2. State whether the child may edit files. Default to read-only unless edits are requested.
3. Ask for evidence: file paths, commands run, assumptions, and confidence.
4. Verify important claims before acting on them.
5. Merge results into the final answer; do not paste unreviewed child output blindly.

## Background / parallel children

For multiple independent children, run them in the background and collect logs:

```bash
workdir="${TMPDIR}/pi-subagents-$(date +%s)"
mkdir -p "$workdir"

cat > "$workdir/a.md" <<'EOF'
You are a focused read-only subagent. Inspect area A and report risks with evidence.
EOF

cat > "$workdir/b.md" <<'EOF'
You are a focused read-only subagent. Inspect area B and report risks with evidence.
EOF

(pi --no-session -p "$(cat "$workdir/a.md")" > "$workdir/a.out" 2>&1 & echo $! > "$workdir/a.pid")
(pi --no-session -p "$(cat "$workdir/b.md")" > "$workdir/b.out" 2>&1 & echo $! > "$workdir/b.pid")

wait "$(cat "$workdir/a.pid")" "$(cat "$workdir/b.pid")"
```

Then read the `*.out` files and synthesize.

## Specialized subagent system prompts

This skill includes reusable system prompt fragments in `prompts/`:

- `prompts/explore.md` — read-only discovery and codebase mapping.
- `prompts/review.md` — adversarial review for bugs, risks, and test gaps.

Include one with `--append-system-prompt` and keep the task-specific instructions in the `-p` prompt:

```bash
pi --no-session \
  --exclude-tools edit,write \
  --append-system-prompt ~/.pi/agent/skills/pi-spawn-subagents/prompts/explore.md \
  -p "$(cat "$prompt_file")"
```

For review:

```bash
pi --no-session \
  --exclude-tools edit,write \
  --append-system-prompt ~/.pi/agent/skills/pi-spawn-subagents/prompts/review.md \
  -p "$(cat "$prompt_file")"
```

Use these as behavioral defaults only. The parent prompt should still specify the exact scope, files, questions, constraints, and desired output.

## Model selection

Use the current default model unless there is a reason to override it.

Pi model names are often scoped as `provider/model`, for example:

- `openai-codex/gpt-5.5`
- `openai-codex/gpt-5.4-mini`
- `opencode-go/qwen3.7-max`

To identify the user's scoped models:

1. Read `~/.pi/agent/settings.json` and inspect `enabledModels`.
2. If needed, run `pi --list-models` or `pi --list-models <search>` to see available provider/model IDs.
3. Prefer exact scoped names from `enabledModels` when spawning a child, because they reflect the user's configured model set.

To choose a child model explicitly, pass the scoped model to `--model`:

```bash
pi --no-session --model openai-codex/gpt-5.4-mini -p "$(cat "$prompt_file")"
```

Use smaller/faster models for broad searches or simple summarization. Use stronger models for design critique, difficult debugging, or final review.

## Read-only subagents with `--exclude-tools`

For review or investigation subagents, make them read-only by disabling mutating tools. At minimum, exclude `edit` and `write`:

```bash
pi --no-session --exclude-tools edit,write -p "$(cat "$prompt_file")"
```

This still leaves `bash` available for inspection commands such as `git status`, `rg`, `find`, and test commands. Because `bash` can also mutate files, the child prompt must also say:

```text
Do not edit files. Do not run mutating shell commands. Only inspect and report.
```

For stricter read-only children that should not run shell commands at all, also exclude `bash`:

```bash
pi --no-session --exclude-tools bash,edit,write -p "$(cat "$prompt_file")"
```

That stricter mode leaves the child mostly limited to file reads and may reduce its ability to search. If search-only built-in tools are available in the current pi version, another strict read-only pattern is to allowlist read-only tools:

```bash
pi --no-session --tools read,grep,find,ls -p "$(cat "$prompt_file")"
```

Use `--exclude-tools edit,write` as the default for practical read-only investigations, and reserve stricter modes for sensitive directories or when the user explicitly asks to prevent shell access.

## Safety defaults

- Prefer read-only child prompts with `--exclude-tools edit,write` unless the user explicitly wants delegated implementation.
- If a child may edit, give it a narrow scope and inspect `git diff` afterward.
- Avoid launching unbounded numbers of children; 2-4 is usually enough.
- Do not commit, push, install dependencies, or run destructive commands from a child unless the user explicitly authorized that action.
