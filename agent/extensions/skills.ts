import {
  DefaultResourceLoader,
  DynamicBorder,
  type ExtensionAPI,
  getAgentDir,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { homedir } from "node:os";

type SkillRow = {
  name: string;
  source: string;
  invocable: boolean;
  location: string;
  description: string;
};

const tildify = (path: string): string => {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

const makeSkillRows = (skills: Skill[]): SkillRow[] =>
  skills.map((skill) => ({
    name: skill.name,
    source: skill.sourceInfo?.scope ?? skill.sourceInfo?.source ?? "user",
    invocable: !skill.disableModelInvocation,
    location: tildify(skill.filePath),
    description: skill.description?.trim() || "No description",
  }));

const padToWidth = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - visibleWidth(text)));

const renderDescription = (
  location: string,
  description: string,
  width: number,
  theme: any,
): string[] => {
  const locLines = wrapTextWithAnsi(location, width).map((l) =>
    theme.fg("muted", l),
  );
  const lines = description.replace(/\r\n/g, "\n").split("\n");
  const descLines = lines.flatMap((line) => {
    if (line.trim() === "") return [""];
    return wrapTextWithAnsi(line.trim(), width);
  });
  return [
    ...locLines,
    ...(descLines.length > 0 ? descLines : ["No description"]),
  ];
};

const renderSkillsTable = (
  rows: SkillRow[],
  width: number,
  theme: any,
): string[] => {
  if (rows.length === 0) return [" No skills registered."];

  const availableWidth = Math.max(40, width - 4);
  const maxLabelWidth = Math.max(
    "Name".length,
    ...rows.map((row) => visibleWidth(`${row.name}(${row.source}) ✔`)),
  );
  const nameWidth = Math.min(34, Math.max(10, maxLabelWidth));
  const descriptionWidth = Math.max(20, availableWidth - nameWidth - 7);
  const topRule = ` ┌${"─".repeat(nameWidth + 2)}┬${"─".repeat(descriptionWidth + 2)}┐`;
  const midRule = ` ├${"─".repeat(nameWidth + 2)}┼${"─".repeat(descriptionWidth + 2)}┤`;
  const bottomRule = ` └${"─".repeat(nameWidth + 2)}┴${"─".repeat(descriptionWidth + 2)}┘`;
  const output = [
    topRule,
    ` │ ${padToWidth("Name", nameWidth)} │ ${padToWidth("Location & description", descriptionWidth)} │`,
    midRule,
  ];

  for (const row of rows) {
    const invocable = row.invocable
      ? theme.fg("success", "✔")
      : theme.fg("error", "✘");
    const label = `${truncateToWidth(`${row.name}(${row.source})`, nameWidth - 2)} ${invocable}`;
    const labelCell = padToWidth(label, nameWidth);
    const descriptionLines = renderDescription(
      row.location,
      row.description,
      descriptionWidth,
      theme,
    );

    descriptionLines.forEach((descriptionLine, index) => {
      output.push(
        ` │ ${index === 0 ? labelCell : " ".repeat(nameWidth)} │ ${padToWidth(descriptionLine, descriptionWidth)} │`,
      );
    });
    output.push(midRule);
  }

  output[output.length - 1] = bottomRule;
  return output.map((line) =>
    visibleWidth(line) > width ? truncateToWidth(line, width) : line,
  );
};

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("skills-list", (message, _options, theme) => {
    const rows = Array.isArray(message.details)
      ? (message.details as SkillRow[])
      : [];
    const container = new Container();
    container.addChild(new DynamicBorder());
    container.addChild(
      new Text(theme.bold(theme.fg("accent", "Skills")), 1, 0),
    );
    container.addChild(new Spacer(1));
    container.addChild({
      invalidate() {},
      render(width) {
        return renderSkillsTable(rows, width, theme);
      },
    });
    container.addChild(new DynamicBorder());
    return container;
  });

  pi.registerCommand("skills", {
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

      pi.sendMessage(
        {
          customType: "skills-list",
          display: true,
          content: "Skills",
          details: makeSkillRows(sorted),
        },
        { triggerTurn: false },
      );
    },
  });
}
