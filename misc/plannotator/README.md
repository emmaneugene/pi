# Plannotator cookie helpers

Files in this directory:

- `plannotator-cookies.json` — exported cookie snapshot
- `export-plannotator-cookies.js` — paste into a Plannotator browser console to export current `plannotator-*` cookies as JSON
- `import-plannotator-cookies.js` — generate browser JS from a JSON file so the cookies can be re-applied in a Plannotator page

## Export current browser cookies to JSON

1. Open a Plannotator page in your browser.
2. Open DevTools Console.
3. Paste `export-plannotator-cookies.js`.
4. It prints JSON to the console and downloads `plannotator-cookies.json`.

## Generate browser JS from JSON

Print JS to stdout:

```bash
node misc/plannotator/import-plannotator-cookies.js misc/plannotator/plannotator-cookies.json
```

Write JS to a file:

```bash
node misc/plannotator/import-plannotator-cookies.js \
  misc/plannotator/plannotator-cookies.json \
  -o misc/plannotator/apply-plannotator-cookies.js
```

Then paste the generated JS into the DevTools Console on a Plannotator page.
