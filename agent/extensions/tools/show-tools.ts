import {
  type ExtensionAPI,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { showCatalog, type CatalogEntry } from "../../lib/tui/picker.ts";

const sourceLabel = (tool: ToolInfo): string => {
  const source = tool.sourceInfo?.source;
  if (!source || source === "builtin") return "builtin";
  if (source === "sdk") return "sdk";
  return "extension";
};

/** Render every available detail of a tool into a markdown artefact. */
const toolDoc = (tool: ToolInfo, active: boolean): string => {
  const guidelines = tool.promptGuidelines ?? [];
  const lines: string[] = [
    `# ${tool.name}`,
    "",
    `- source: ${sourceLabel(tool)}`,
    `- active: ${active ? "yes" : "no"}`,
    "",
    "## Description",
    "",
    tool.description?.trim() || "No description",
    "",
  ];
  if (guidelines.length > 0) {
    lines.push(
      "## Prompt guidelines",
      "",
      ...guidelines.map((g) => `- ${g}`),
      "",
    );
  }
  lines.push(
    "## Parameters (schema)",
    "",
    "```json",
    JSON.stringify(tool.parameters ?? {}, null, 2),
    "```",
    "",
  );
  return lines.join("\n");
};

const toEntry = (tool: ToolInfo, active: boolean): CatalogEntry => {
  const mark = active ? "✔" : "✘";
  const oneLine = (tool.description?.trim() || "No description")
    .replace(/\s+/g, " ")
    .trim();
  return {
    item: {
      value: tool.name,
      label: tool.name,
      description: `(${sourceLabel(tool)}) ${mark}  ${oneLine}`,
    },
    artifact: () => ({ content: toolDoc(tool, active), ext: ".md" }),
  };
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("show-tools", {
    description: "Show tools available to the agent in this session",
    handler: async (_args, ctx) => {
      const activeNames = new Set(pi.getActiveTools());
      const tools = pi
        .getAllTools()
        .sort((a, b) => a.name.localeCompare(b.name));

      await showCatalog(
        ctx,
        "Tools",
        tools.map((t) => toEntry(t, activeNames.has(t.name))),
      );
    },
  });
}
