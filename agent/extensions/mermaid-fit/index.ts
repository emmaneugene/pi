import { Marked, truncateToWidth, type Token } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { render } from "grok-mermaid";

const markdownParser = new Marked();

type MermaidCodeToken = Token & {
  type: "code";
  text: string;
  lang?: string;
};

function isMermaid(token: Token): token is MermaidCodeToken {
  return (
    token.type === "code" &&
    token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid"
  );
}

function codeSpan(line: string): string {
  const content = line || "\u00a0";
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestBacktickRun + 1);
  const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${fence}${padding}${content}${padding}${fence}`;
}

/** Render Mermaid blocks that Pi left unchanged because their art is too wide. */
export function renderOversizedMermaid(
  markdown: string,
  availableWidth: number,
): string {
  const width = Math.max(1, availableWidth);

  return markdownParser
    .lexer(markdown)
    .map((token) => {
      if (!isMermaid(token)) return token.raw;

      const art = render(token.text);
      if (!art || art.width <= width) return token.raw;

      const lines = art.plain.map((line) => truncateToWidth(line, width, "…"));
      return `${lines.map(codeSpan).join("  \n")}\n`;
    })
    .join("");
}

export default function mermaidFitExtension(pi: ExtensionAPI): void {
  pi.registerMarkdownTransformer((markdown, context) => {
    // Let Pi's built-in transformer control streaming and thinking rendering.
    if (context.isStreaming || context.messageType === "assistant-thinking") {
      return markdown;
    }
    return renderOversizedMermaid(markdown, context.availableWidth);
  });
}
