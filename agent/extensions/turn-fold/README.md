# Turn fold

Compact transcript rendering for the Pi coding agent.

This extension vendors [`@onurpi/turn-fold`](https://github.com/osolmaz/onurpi/tree/a08b31aae8a549b8fd8f0d02662a593485adcc7a/packages/turn-fold) at commit `a08b31aae8a549b8fd8f0d02662a593485adcc7a`.

`@onurpi/turn-fold` keeps Pi's working line and the latest three activity rows visible during a
run. Earlier activity is replaced by one summary row directly below the user message. When the run
stops, that position holds the `Worked for …` line. User messages show their local timestamp on the
bottom line, and the retained final response shows its completion time below the content. Turn Fold
keeps one padding line before the next user message instead of Pi's usual two. Tool rows and
intermediate assistant messages disappear, leaving the final response below the summary. Interrupted
runs retain their last partial response or a fallback message.

The extension changes only the display. Pi keeps every underlying session message in model context.
The normative behavior is defined in [SPEC.md](SPEC.md).

## Modes

| Mode       | Behavior                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| `compact`  | Shows a summary below the user message, followed by live or final activity. |
| `expanded` | Shows the complete transcript.                                              |

`compact` is the default.

## Try it

Pi loads the extension automatically from `~/.pi/agent/extensions/turn-fold/`. To load only this extension for one session:

```bash
pi --no-extensions -e ~/.pi/agent/extensions/turn-fold/index.ts
```

## Controls

```text
/turn-fold                  open the mode picker
/turn-fold compact          use the compact transcript
/turn-fold expanded         show the complete transcript
/turn-fold toggle           switch between compact and expanded
/turn-fold status           show the current mode
```

`Ctrl+Shift+O` switches between compact and expanded rendering without adding a shortcut hint to
summary lines. `Ctrl+O` remains Pi's separate tool-output detail toggle.

Mode changes are stored as custom session entries, so each session restores its latest supported
choice. Historical turns are reconstructed from the active session branch when Pi starts or
reloads. Older `live` and `final-only` values are no longer modes and resolve to the compact default.

## Current implementation boundary

Pi does not expose a public whole-turn transcript renderer. This extension uses Pi's exported
assistant and tool component classes but patches their rendering methods. It targets Pi 0.80.10 or
newer and must be retested when Pi changes its interactive transcript components.

## Development

Run the vendored upstream test suite from `~/.pi/agent/`:

```bash
npm run test:turn-fold
```

Type-check the runtime and tests:

```bash
npx tsc -p extensions/turn-fold/tsconfig.check.json
```

The upstream package retains its coverage, mutation, and Slophammer configuration.
