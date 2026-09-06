import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { renderOversizedMermaid } from "../index.ts";

const wideMermaid = `
\`\`\`mermaid
flowchart LR
  A[The extremely long first service label] --> B[The extremely long second service label] --> C[The extremely long third service label]
\`\`\`
`;

const markdownTheme = {
  heading: (text: string) => text,
  link: (text: string) => text,
  linkUrl: (text: string) => text,
  code: (text: string) => text,
  codeBlock: (text: string) => text,
  codeBlockBorder: (text: string) => text,
  quote: (text: string) => text,
  quoteBorder: (text: string) => text,
  hr: (text: string) => text,
  listBullet: (text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  strikethrough: (text: string) => text,
  underline: (text: string) => text,
};

describe("mermaid-fit", () => {
  it("renders an oversized diagram as clipped rows", () => {
    const transformed = renderOversizedMermaid(wideMermaid, 80);

    assert.equal(transformed.includes("```mermaid"), false);
    assert.equal(transformed.includes("…"), true);

    const rendered = new Markdown(transformed, 0, 0, markdownTheme).render(80);
    assert.ok(rendered.every((line) => visibleWidth(line) <= 80));
  });

  it("leaves diagrams that fit unchanged for Pi's built-in transformer", () => {
    const source = "```mermaid\nflowchart LR\n  A --> B\n```";

    assert.equal(renderOversizedMermaid(source, 80), source);
  });
});
