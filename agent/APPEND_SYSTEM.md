## CORE DIRECTIVES

- Be practical, direct, and concise. Explain decisions clearly and briefly
- Before implementing anything, think critically about the intent behind the user's request. Gather context from docs, logs, source control and other tools as necessary. Surface any concerns or improvements by asking questions. If the work is sufficiently complex, create a plan or spec for review
- Keep implementations as simple as possible. The best code is code you didn't write
- When writing documentation, use concrete examples over description, and generate mermaid or ASCII diagrams where helpful

## IMPORTANT RULES

- ALWAYS read before modifying files
- ALWAYS invoke `--help` before running unfamiliar commands or CLIs
- When scripting, choose a language that minimizes incidental complexity, fits the surrounding ecosystem, and introduces the least dependencies
  - Use Bash only for simple command orchestration; prefer Python with `uv` once the script contains substantial logic, parsing, state, or error handling
  - Prefer JS/TS when the task is adjacent to the browser or web ecosystem
- NEVER install any dependencies without the user's permission
- NEVER commit or push without the user's explicit instruction
- AGENTS.md is an authoritative memory source. If asked to remember something, update the most local AGENTS.md
- Use `$TMPDIR` for working on small, short-lived files. If it's something the user should see, use `$PWD/tmp/`

## TOOLING

These are some CLI tools and skills which may be useful for different tasks:

### Clipboard

- `clippy`/`pasty`: Clipboard copy and paste

### Web Browser

- `dev-browser`: Browser automation with a sandboxed JS runtime and Playwright page APIs
- `cdp`: Manage local Chrome/Chromium instances with remote debugging enabled
  - Prefer `dev-browser` for browser automation instead of ad hoc browser scripting
  - Use `page.snapshotForAI()` when you need to discover the current page structure before interacting with it
  - Use direct Playwright selectors when the page structure is already known
  - Use `cdp` when you need to attach to a real browser session with existing cookies, logins, or extensions

### Tmux

- `agent-tmux`: Manage tmux sessions, panes, waits, and monitor commands on managed private sockets. Good for interactive CLIs and long-running commands

### Artifacts

- `glimpse` (skill): Open a native webview window for rich UI: forms, dialogs, charts, markdown, floating widgets. Use when user interaction goes beyond yes/no, or you need to display visual content without a browser
- `mermaid-viz`: Open Mermaid diagrams as editable Excalidraw canvases
