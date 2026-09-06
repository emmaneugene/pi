#!/bin/sh
# Check extensions against the installed pi: show breaking changes since the
# pinned version, then bump pinned deps, typecheck, and test.
set -eu
cd "$(dirname "$0")/.."

# npm puts node_modules/.bin (pinned pi) first on PATH; ask mise for the real one.
installed=$(mise exec -- pi --version)
pinned=$(node -p 'require("./package.json").dependencies["@earendil-works/pi-coding-agent"]')
changelog=$(dirname "$(mise which pi)")/../@earendil-works/pi-coding-agent/CHANGELOG.md

if [ "$installed" = "$pinned" ]; then
  echo "pinned deps already match pi $installed"
else
  echo "pi $pinned -> $installed. Breaking changes:"
  awk -v stop="## [$pinned]" 'index($0, stop) == 1 { exit }
    /^## \[/ { v = $2 } /^### Breaking/ { p = 1; print v; next } /^### / { p = 0 } p' "$changelog"
  npm install --save-exact \
    "@earendil-works/pi-ai@$installed" \
    "@earendil-works/pi-coding-agent@$installed" \
    "@earendil-works/pi-tui@$installed"
fi

npm run typecheck
npm test
