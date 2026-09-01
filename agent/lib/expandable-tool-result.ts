import { stripVTControlCharacters } from "node:util";
import {
  type AgentToolResult,
  keyText,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";

const DEFAULT_COLLAPSED_LINES = 8;

interface RenderTheme {
  fg(name: string, text: string): string;
}

interface ExpandableToolResultOptions {
  collapsedLines?: number;
}

class ExpandableText implements Component {
  private readonly content: Text;
  private readonly hint: Text;
  private readonly expanded: boolean;
  private readonly collapsedLines: number;

  constructor(
    text: string,
    expanded: boolean,
    collapsedLines: number,
    theme: RenderTheme,
  ) {
    this.content = new Text(theme.fg("toolOutput", text), 0, 0);
    this.hint = new Text(
      theme.fg("muted", `…\n(${keyText("app.tools.expand")} to expand)`),
      0,
      0,
    );
    this.expanded = expanded;
    this.collapsedLines = collapsedLines;
  }

  render(width: number): string[] {
    const lines = this.content.render(width);
    if (this.expanded || lines.length <= this.collapsedLines) return lines;
    return [...lines.slice(0, this.collapsedLines), ...this.hint.render(width)];
  }

  invalidate(): void {
    this.content.invalidate();
    this.hint.invalidate();
  }
}

function sanitizeDisplayText(text: string): string {
  return Array.from(stripVTControlCharacters(text))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return false;
      if (codePoint === 0x09 || codePoint === 0x0a) return true;
      if (codePoint <= 0x1f) return false;
      return codePoint < 0xfff9 || codePoint > 0xfffb;
    })
    .join("")
    .replace(/\r/gu, "");
}

function resultText(result: Pick<AgentToolResult<unknown>, "content">): string {
  return result.content
    .flatMap((block): string[] =>
      block.type === "text"
        ? [sanitizeDisplayText(block.text)]
        : [`[image: ${block.mimeType}]`],
    )
    .join("\n");
}

/** Render bounded tool output by default and reveal the complete result on expansion. */
export function renderExpandableToolResult(
  result: Pick<AgentToolResult<unknown>, "content">,
  options: ToolRenderResultOptions,
  theme: RenderTheme,
  context: { isError: boolean },
  rendererOptions: ExpandableToolResultOptions = {},
): Component {
  return new ExpandableText(
    resultText(result),
    options.expanded || context.isError,
    rendererOptions.collapsedLines ?? DEFAULT_COLLAPSED_LINES,
    theme,
  );
}
