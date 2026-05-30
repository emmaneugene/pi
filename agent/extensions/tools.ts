import { DynamicBorder, type ExtensionAPI, type ToolInfo } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const sourceLabel = (tool: ToolInfo): string => {
  const source = tool.sourceInfo?.source;
  if (!source || source === "builtin") return "builtin";
  if (source === "sdk") return "sdk";
  return "extension";
};

type ToolRow = {
  name: string;
  source: string;
  active: boolean;
  description: string;
};

const makeToolRows = (tools: ToolInfo[], activeNames: Set<string>): ToolRow[] =>
  tools.map((tool) => ({
    name: tool.name,
    source: sourceLabel(tool),
    active: activeNames.has(tool.name),
    description: tool.description?.trim() || "No description",
  }));

const padToWidth = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - visibleWidth(text)));

const renderDescription = (description: string, width: number): string[] => {
  const lines = description.replace(/\r\n/g, "\n").split("\n");
  const rendered = lines.flatMap((line) => {
    if (line.trim() === "") return [""];
    return wrapTextWithAnsi(line.trim(), width);
  });
  return rendered.length > 0 ? rendered : ["No description"];
};

const renderToolsTable = (rows: ToolRow[], width: number, theme: any): string[] => {
  if (rows.length === 0) return [" No tools registered."];

  const availableWidth = Math.max(40, width - 4);
  const maxLabelWidth = Math.max(
    "Name".length,
    ...rows.map((row) => visibleWidth(`${row.name}(${row.source}) ${row.active ? "✔" : "✘"}`)),
  );
  const nameWidth = Math.min(34, Math.max(10, maxLabelWidth));
  const descriptionWidth = Math.max(20, availableWidth - nameWidth - 7);
  const topRule = ` ┌${"─".repeat(nameWidth + 2)}┬${"─".repeat(descriptionWidth + 2)}┐`;
  const midRule = ` ├${"─".repeat(nameWidth + 2)}┼${"─".repeat(descriptionWidth + 2)}┤`;
  const bottomRule = ` └${"─".repeat(nameWidth + 2)}┴${"─".repeat(descriptionWidth + 2)}┘`;
  const output = [
    topRule,
    ` │ ${padToWidth("Name", nameWidth)} │ ${padToWidth("Description", descriptionWidth)} │`,
    midRule,
  ];

  for (const row of rows) {
    const active = row.active ? theme.fg("success", "✔") : theme.fg("error", "✘");
    const label = `${truncateToWidth(`${row.name}(${row.source})`, nameWidth - 2)} ${active}`;
    const labelCell = padToWidth(label, nameWidth);
    const descriptionLines = renderDescription(row.description, descriptionWidth);

    descriptionLines.forEach((descriptionLine, index) => {
      output.push(
        ` │ ${index === 0 ? labelCell : " ".repeat(nameWidth)} │ ${padToWidth(descriptionLine, descriptionWidth)} │`,
      );
    });
    output.push(midRule);
  }

  output[output.length - 1] = bottomRule;
  return output.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width) : line));
};

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("tools-list", (message, _options, theme) => {
    const rows = Array.isArray(message.details) ? (message.details as ToolRow[]) : [];
    const container = new Container();
    container.addChild(new DynamicBorder());
    container.addChild(new Text(theme.bold(theme.fg("accent", "Tools")), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild({
      invalidate() {},
      render(width) {
        return renderToolsTable(rows, width, theme);
      },
    });
    container.addChild(new DynamicBorder());
    return container;
  });

  pi.registerCommand("tools", {
    description: "Show tools available to the agent in this session",
    handler: async () => {
      const allTools = pi.getAllTools();
      const activeNames = new Set(pi.getActiveTools());
      const tools = allTools.sort((a, b) => a.name.localeCompare(b.name));

      pi.sendMessage(
        {
          customType: "tools-list",
          display: true,
          content: "Tools",
          details: makeToolRows(tools, activeNames),
        },
        { triggerTurn: false },
      );
    },
  });
}
