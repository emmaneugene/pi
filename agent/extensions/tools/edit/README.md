# edit-replace-all

Overrides the built-in `edit` tool so a mechanical rewrite is expressible in one reviewable call, and so an ambiguous match says where it is ambiguous.

## What changes

**`edits[].replaceAll`** rewrites every occurrence of `oldText`:

```json
{
  "path": "src/api.ts",
  "edits": [
    { "oldText": "getUser", "newText": "fetchUser", "replaceAll": true }
  ]
}
```

The built-in schema has no way to express this, so a 40-site rename had no correct single call and tended to become an inline `python`/`sed` invocation — invisible to the diff render, the file mutation queue, and post-edit hooks.

**Duplicate matches are located.** The built-in reports a count and discards the positions:

```
Found 3 occurrences of edits[1] in src/api.ts. Each oldText must be unique. Please provide more context to make it unique.
```

This override reports:

```
Found 3 occurrences of edits[1] in src/api.ts at lines 12, 40, 88. Add surrounding context to
target a single occurrence, or set edits[1].replaceAll: true to rewrite all 3.
```

## How it works

**This override never writes a file.** Every call is applied by the built-in definition, so path resolution, the file mutation queue, BOM and line-ending preservation, abort handling, and diff rendering are all upstream behavior rather than a second implementation of it.

A `replaceAll` call is expressed to the built-in as a single whole-file replacement: this extension reads the file, computes the new content, and hands the built-in one edit whose `oldText` is the entire original content. That has a useful safety property. The built-in re-reads the file under the mutation queue and refuses the write if `oldText` no longer matches, so if the file changed after this extension read it, the result is a clean failure rather than a silent clobber of the concurrent write.

`replaceAll` matching is **exact only** — no whitespace-insensitive fallback, because widening a fuzzy match across every occurrence of a file is not a safe default.

On the ordinary path, the built-in runs first and this override only rewrites its error. When the built-in reports a bare duplicate count, the file is re-read to locate the occurrences. That scan tries exact matching, then the whitespace-insensitive matcher, and the line numbers are only reported if the count agrees with what the built-in said — so a drift in the mirrored normalization degrades the message instead of misreporting positions.

The preview is withheld while a `replaceAll` call streams in: the built-in preview runs the built-in matcher, which would paint a red duplicate error for a call that is about to succeed. The applied diff still renders once the result lands.

Extending the built-in rather than reimplementing it is deliberate. Extensions resolve `@earendil-works/pi-coding-agent` to the running CLI, and the matching internals (`fuzzyFindText`, `applyReplacementsPreservingUnchangedLines`) are not part of its public exports — a copy of them here would silently drift from whatever the running CLI does.

The one unavoidable duplication is reading the file to plan a `replaceAll`, which needs a resolved path. That goes through `resolveToolPath` in `lib/paths.ts`, mirroring the built-in resolver (`@` prefix, `~`, `file://`, Unicode spaces, and notably **no** trimming, which upstream does not do either). `turn-diff` resolves tool paths with the same function, which matters: it decides which file to snapshot while this tool decides which file to write, so the two must never disagree. A divergence would otherwise mean planning against the wrong file, which the built-in then rejects because the whole-file `oldText` will not match.

## Tests

```
npm test   # from ~/.pi/agent
```

`test/replace.test.ts` covers the matching logic; `test/tool.test.ts` drives the registered tool against real files, including the delegated path; `test/regression.test.ts` holds cases from review — concurrent edits to one file, trailing-whitespace paths, and whitespace-insensitive duplicate locating.
