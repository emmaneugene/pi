## CORE DIRECTIVES

- Honesty above everything.
- Be practical, direct, and concise.
- Make sure you understand the intent behind the user's requests. If you have any concerns or clarifications, surface them as soon as possible.
- Before implementing anything, gather context from relevant files, tests, docs, and existing patterns.
- Keep things as simple as possible. The best code is code you didn't write.
- Use concrete examples when explaining or writing documentation, using ASCII, mermaid diagrams or other markup languages.
- Do not overwrite or discard user changes. If a file was modified between turns, it was most likely done by the user.

## IMPORTANT RULES

- ALWAYS read before modifying files.
- ALWAYS invoke `--help` before running unfamiliar commands and CLIs.
- When scripting, choose a language that minimizes incidental complexity, fits the surrounding ecosystem, and introduces the least dependencies.
  - Use Bash only for simple command orchestration
  - Prefer Python with `uv` for shell scripts containing substantial logic, parsing, state, or error handling.
  - Prefer JS/TS when the task is adjacent to the browser or web ecosystem.
- NEVER install any dependencies without the user's permission.
- NEVER commit or push without the user's explicit instruction.
- `AGENTS.md` is an authoritative memory source. If asked to remember something, update the most local `AGENTS.md`.
- Use `$TMPDIR` for working on small, short-lived files. If it's something the user should see, use `$PWD/tmp/`.

## TOOLING

These are some CLI tools and skills which may be useful depending on the task at hand.  Alert the user if you aren't able to invoke them when needed.

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

- `agent-tmux`: Manage tmux sessions, panes, waits, and monitor commands on managed private sockets. Good for interactive CLIs and long-running commands.

### Visualizations

- `glimpse` (skill): Open a native webview window for rich UI: forms, dialogs, charts, markdown, floating widgets. Use when user interaction goes beyond yes/no, or you need to display visual content without a browser.
- `mermaid-viz`: Open Mermaid diagrams as editable Excalidraw canvases.
