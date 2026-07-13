# CLIs

Command-line tools referenced by `agent/SYSTEM.md`. Some are bundled here as
standalone scripts; the rest are installed through a package manager.

## Bundled (in this directory)

Copy these onto your `PATH` (e.g. `~/bin/`) and make them executable
(`chmod +x`).

| Tool          | Purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `agent-tmux`  | Run interactive and long-running commands in tmux                       |
| `cdp`         | Attach to a real browser session (existing cookies, logins, extensions) |
| `mermaid-viz` | Render and edit Mermaid diagrams                                        |

To install all three:

```sh
install -m 0755 agent-tmux cdp mermaid-viz ~/bin/
```

## Installed via package manager

These are not bundled — install them with Homebrew or npm.

| Tool          | Install                      | Purpose                                                    |
| ------------- | ---------------------------- | ---------------------------------------------------------- |
| `clippy`      | `brew install clippy`        | Clipboard: copy files/text from the terminal into GUI apps |
| `pasty`       | `brew install clippy`        | Clipboard paste (ships in the `clippy` formula)            |
| `usql`        | `brew install xo/xo/usql`    | Universal command-line SQL client                          |
| `dev-browser` | `npm install -g dev-browser` | Browser automation (`page.snapshotForAI()`)                |

Quick one-liner:

```sh
brew install clippy xo/xo/usql   # clippy + pasty + usql
npm install -g dev-browser       # dev-browser
```
