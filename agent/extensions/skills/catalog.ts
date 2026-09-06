import { type ExtensionAPI, type Skill } from "@earendil-works/pi-coding-agent";
import { showCatalog, type CatalogEntry } from "../../lib/tui/picker.ts";

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
    artifact: () => ({ kind: "file", path: skill.filePath }),
  };
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("show-skills", {
    description: "Show skills available to the agent in this session",
    handler: async (_args, ctx) => {
      const skills = ctx.getSystemPromptOptions().skills ?? [];
      const sorted = skills
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));

      await showCatalog(ctx, "Skills", sorted.map(toEntry));
    },
  });
}
