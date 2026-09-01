# @onurpi/turn-fold

- Preserve Pi's underlying session messages and model context; folding is display-only.
- Keep folding policy and turn state separate from Pi component patching.
- Derive aggregate and per-file diffstats only from successful finalized tool-result patches. Resolve relative patch paths against Pi's documented `ctx.cwd`; do not inspect Git or snapshot files.
- Retest component patches against each supported Pi release.
- Run `npm run typecheck` and `npm run test:turn-fold` from `agent/` before finishing. Upstream-only coverage, Slophammer, and mutation dependencies are not vendored.
