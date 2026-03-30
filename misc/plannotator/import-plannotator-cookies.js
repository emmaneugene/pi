#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

function loadCookies(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const cookies = Object.fromEntries(
    Object.entries(data)
      .filter(([k]) => k.startsWith("plannotator-"))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  if (!Object.keys(cookies).length)
    throw new Error("No plannotator-* cookies found");
  return cookies;
}

function renderApplyScript(cookies, source) {
  const json = JSON.stringify(cookies, null, 2);
  return `\
// Generated from ${source}
(() => {
  const cookies = ${json};

  for (const [name, value] of Object.entries(cookies)) {
    document.cookie = \`\${name}=\${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax\`;
  }

  console.log(\`Applied \${Object.keys(cookies).length} Plannotator cookies.\`);
  console.table(cookies);
  console.log('Reload the page if the UI does not update immediately.');
})();
`;
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { output: { type: "string", short: "o" } },
  allowPositionals: true,
});

const jsonPath = positionals[0] ?? "misc/plannotator/plannotator-cookies.json";

let cookies;
try {
  cookies = loadCookies(jsonPath);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}

const script = renderApplyScript(cookies, jsonPath);

if (values.output) {
  mkdirSync(dirname(values.output), { recursive: true });
  writeFileSync(values.output, script, "utf8");
} else {
  process.stdout.write(script);
}
