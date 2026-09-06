# @onurpi/turn-fold

- Preserve Pi's underlying session messages and model context; folding is display-only.
- Keep folding policy and turn state separate from Pi component patching.
- Retest component patches against each supported Pi release.
- Run `npm run typecheck` and `npm test -- extensions/turn/fold` from `agent/` before finishing. Upstream-only coverage, Slophammer, and mutation dependencies are not vendored.
