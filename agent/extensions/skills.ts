import {
  DefaultResourceLoader,
  type ExtensionAPI,
  getAgentDir,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../lib/json-state.ts";
import { showCatalog, type CatalogEntry } from "../lib/tui/picker.ts";

const STATE_FILE = join(getAgentDir(), "skill-inject.json");

function loadState(): { enabled: boolean } {
  const state = readJsonFile(STATE_FILE) as { enabled?: boolean } | undefined;
  return { enabled: state?.enabled ?? true };
}

function saveState(state: { enabled: boolean }): void {
  writeJsonFile(STATE_FILE, state);
}

let injectSkills = loadState().enabled;

const sourceOf = (skill: Skill): string =>
  skill.sourceInfo?.scope ?? skill.sourceInfo?.source ?? "user";

const toEntry = (skill: Skill): CatalogEntry => {
  const invocable = !skill.disableModelInvocation;
  const mark = invocable ? "✔" : "✘";
  const oneLine = (skill.description?.trim() || "No description")
    .replace(/\s+/g, " ")
    .trim();
  return {
    item: {
      value: skill.name,
      label: skill.name,
      description: `(${sourceOf(skill)}) ${mark}  ${oneLine}`,
    },
    // The artefact is the full SKILL.md.
    artifact: () => ({
      path: skill.filePath,
      content: readFileSync(skill.filePath, "utf-8"),
      ext: ".md",
    }),
  };
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("skill-inject", {
    description: "Toggle skill metadata injection in system prompt",
    handler: async (_args, ctx) => {
      injectSkills = !injectSkills;
      saveState({ enabled: injectSkills });
      ctx.ui.notify(
        injectSkills
          ? "Skill metadata will be injected to system prompt"
          : "Skill metadata hidden from system prompt",
        "info",
      );
    },
  });

  pi.registerCommand("show-skills", {
    description: "Show skills available to the agent in this session",
    handler: async (_args, ctx) => {
      // Use the full resource loader so npm-package skills (resolved via the
      // package manager) are included, not just the default skill dirs.
      const loader = new DefaultResourceLoader({
        cwd: ctx.cwd,
        agentDir: getAgentDir(),
      });
      const trusted = ctx.isProjectTrusted();
      await loader.reload({ resolveProjectTrust: () => trusted });
      const { skills } = loader.getSkills();
      const sorted = skills
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));

      await showCatalog(ctx, "Skills", sorted.map(toEntry));
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (injectSkills) return;

    const { systemPrompt } = event;

    // Strip skill metadata using its semantic prompt boundary.
    const cleaned = systemPrompt.replace(
      /\n?<available_skills>[\s\S]*?<\/available_skills>\n?/,
      "",
    );

    if (cleaned !== systemPrompt) {
      return { systemPrompt: cleaned };
    }
  });
}
