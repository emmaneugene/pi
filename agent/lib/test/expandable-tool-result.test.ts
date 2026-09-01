import { describe, expect, it } from "vitest";

import { renderExpandableToolResult } from "../expandable-tool-result.ts";

const theme = { fg: (_name: string, text: string) => text };
const result = {
  content: [
    {
      type: "text" as const,
      text: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join(
        "\n",
      ),
    },
  ],
};

function render(expanded: boolean, isError = false): string[] {
  return renderExpandableToolResult(
    result,
    { expanded, isPartial: false },
    theme,
    { isError },
  )
    .render(80)
    .map((line) => line.trimEnd());
}

describe("expandable tool result", () => {
  it("shows a bounded preview with an expansion hint", () => {
    const lines = render(false);

    expect(lines.slice(0, 8)).toEqual([
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
    ]);
    expect(lines.at(-2)).toBe("…");
    expect(lines.at(-1)).toContain("to expand");
  });

  it("shows the complete result when expanded", () => {
    const lines = render(true);

    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe("line 12");
    expect(lines.some((line) => line.includes("to expand"))).toBe(false);
  });

  it("shows complete errors without requiring expansion", () => {
    expect(render(false, true)).toHaveLength(12);
  });

  it("removes terminal control sequences from tool output", () => {
    const component = renderExpandableToolResult(
      {
        content: [{ type: "text", text: "safe\u001b[31m red\u001b[0m\u0000" }],
      },
      { expanded: true, isPartial: false },
      theme,
      { isError: false },
    );

    expect(component.render(80).map((line) => line.trimEnd())).toEqual([
      "safe red",
    ]);
  });

  it("does not add a hint when the complete result fits", () => {
    const component = renderExpandableToolResult(
      { content: [{ type: "text", text: "short result" }] },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    );

    expect(component.render(80).map((line) => line.trimEnd())).toEqual([
      "short result",
    ]);
  });
});
