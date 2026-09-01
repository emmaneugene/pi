# Skill sources

Repos and directories that aggregate agent skills worth auditing before vendoring
into `agent/skills/`. Vendor a copy, add a `source:` field to the front matter,
and audit before use (see show-me for the pattern).

## Curated author collections

- https://github.com/mattpocock/skills — Matt Pocock; includes the `/teach`
  HTML-explainer skill.
- https://github.com/humanlayer/skills/tree/main/plugins — HumanLayer; includes
  `show-me`.
- https://github.com/cursor/plugins — Cursor's official plugin/skill collection.
- https://github.com/anthropics/skills — Anthropic's public skills repo
  (document handling, artifacts, MCP builders).

## Directories and indexes

- https://www.skills.sh/ — searchable directory with install counts; backs
  `npx skills` (vercel-labs/skills). Useful for discovery:
  `npx skills find "<task>"`.
- https://github.com/VoltAgent/awesome-agent-skills — large curated awesome-list
  (1000+), cross-agent.

## Installing

`npx skills add <owner/repo> --skill <name>` installs into the agent's skill
dir, but prefer manual vendoring into `agent/skills/<name>/` so the copy is
git-tracked and auditable here.
