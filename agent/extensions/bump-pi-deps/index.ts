/**
 * /bump-pi-deps: align the local pi library deps (used for extension
 * typechecking) with the installed pi version.
 *
 * Reads the version from `pi --version`, then runs `npm install` in the
 * agent dir to pin @earendil-works/pi-ai, pi-coding-agent, and pi-tui to
 * that exact version.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const PI_DEPS = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];

function installedPiVersion(): string | undefined {
  const r = spawnSync("pi", ["--version"], { encoding: "utf-8" });
  if (r.status !== 0) return undefined;
  const version = r.stdout.trim();
  return /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
}

function pinnedVersions(agentDir: string): Record<string, string> {
  const pkg = JSON.parse(
    readFileSync(join(agentDir, "package.json"), "utf-8"),
  ) as { dependencies?: Record<string, string> };
  const deps = pkg.dependencies ?? {};
  return Object.fromEntries(
    PI_DEPS.map((name) => [name, deps[name] ?? "(missing)"]),
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("bump-pi-deps", {
    description: "Pin local pi library deps to the installed pi version",
    handler: async (_args, ctx) => {
      const agentDir = getAgentDir();

      const version = installedPiVersion();
      if (!version) {
        ctx.ui.notify("bump-pi-deps: could not read `pi --version`", "error");
        return;
      }

      const pinned = pinnedVersions(agentDir);
      if (Object.values(pinned).every((v) => v === version)) {
        ctx.ui.notify(`pi deps already at ${version}`, "info");
        return;
      }

      const specs = PI_DEPS.map((name) => `${name}@${version}`);
      ctx.ui.notify(`Bumping pi deps to ${version}…`, "info");
      const r = spawnSync("npm", ["install", "--save-exact", ...specs], {
        cwd: agentDir,
        encoding: "utf-8",
      });
      if (r.status !== 0) {
        const detail = (r.stderr || r.stdout || "")
          .trim()
          .split("\n")
          .slice(-3)
          .join(" ");
        ctx.ui.notify(`bump-pi-deps: npm install failed: ${detail}`, "error");
        return;
      }

      const before = [...new Set(Object.values(pinned))].join(", ");
      ctx.ui.notify(`pi deps: ${before} → ${version}`, "info");
    },
  });
}
