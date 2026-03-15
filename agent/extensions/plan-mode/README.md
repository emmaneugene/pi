# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Features

- **Read-only tools**: Restricts available tools to `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`
- **Bash allowlist**: Only read-only bash commands are permitted
- **PLAN.md tracking**: Progress is tracked via a standard markdown checklist file — no special markers needed
- **Session persistence**: Plan mode enabled/disabled state survives session resume

## Commands

- `/plan` — Toggle plan mode
- `Ctrl+Alt+P` — Toggle plan mode (shortcut)
- `--plan` flag — Start session in plan mode

## Workflow

1. Enable plan mode with `/plan` or the `--plan` flag.
2. Ask the agent to explore the codebase and produce a plan. The agent outputs
   a markdown checklist in its response (it cannot write files in plan mode).
3. When the agent finishes, a prompt appears:
   - **Execute the plan** — exits plan mode, restores full tools, and asks the
     agent to write `PLAN.md` then work through it step by step.
   - **Stay in plan mode** — keep exploring.
   - **Refine the plan** — open an editor to send a follow-up message.
4. During execution the agent writes and maintains `PLAN.md`, checking off
   steps as it completes them (`- [ ]` → `- [x]`).

## How It Works

### Plan mode (read-only)

- Only `read`, `bash`, `grep`, `find`, `ls`, `questionnaire` are available
- All bash commands are validated against a safe allowlist; destructive
  commands are blocked with an explanation
- The agent is instructed via a hidden system message to explore and output a
  plan — it cannot write files

### Execution mode

- Plan mode is disabled and full tools are restored
- The agent writes `PLAN.md` with a `- [ ]` checklist at the start of the run
- As each step is completed, the agent edits `PLAN.md` to tick it off (`- [x]`)
- `PLAN.md` is a plain file — you can open, edit, or review it at any time

## Bash allowlist

**Allowed (read-only):**

| Category | Commands |
|----------|----------|
| File inspection | `cat`, `head`, `tail`, `less`, `more` |
| Search | `grep`, `find`, `rg`, `fd` |
| Directory | `ls`, `pwd`, `tree` |
| Text processing | `wc`, `sort`, `uniq`, `diff`, `awk`, `jq`, `sed -n` |
| Git (read) | `git status`, `git log`, `git diff`, `git show`, `git branch`, `git remote` |
| Package info | `npm list/view/outdated/audit`, `yarn list/info/audit` |
| System info | `uname`, `whoami`, `date`, `uptime`, `ps`, `du`, `df` |
| Other | `curl`, `wget -O -`, `bat`, `exa` |

**Blocked:**

| Category | Commands |
|----------|----------|
| File modification | `rm`, `mv`, `cp`, `mkdir`, `touch`, `ln`, `tee`, `truncate` |
| Redirection | `>`, `>>` |
| Git (write) | `git add/commit/push/pull/merge/rebase/reset/checkout/clone` |
| Package install | `npm install`, `yarn add`, `pip install`, `brew install`, etc. |
| System | `sudo`, `kill`, `reboot`, `shutdown`, `systemctl start/stop` |
| Editors | `vim`, `nano`, `emacs`, `code` |
