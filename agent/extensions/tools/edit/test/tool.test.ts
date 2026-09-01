/**
 * Exercises the registered tool end to end against real files: schema, argument
 * preparation, the replaceAll write path, and delegation to the built-in tool.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import register from "../index.ts";

type Tool = {
  name: string;
  parameters: { properties: Record<string, unknown> };
  prepareArguments?: (args: unknown) => unknown;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{
    content: { type: string; text?: string }[];
    details?: { diff?: string };
  }>;
};

let tool: Tool;
let dir: string;

beforeAll(() => {
  const registered: Tool[] = [];
  register({ registerTool: (t: Tool) => registered.push(t) } as never);
  expect(registered).toHaveLength(1);
  tool = registered[0];
  dir = mkdtempSync(join(tmpdir(), "edit-replace-all-"));
});

function fixture(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const run = (params: unknown) =>
  tool.execute(
    "call-1",
    tool.prepareArguments?.(params) ?? params,
    undefined,
    undefined,
    {},
  );

describe("registration", () => {
  it("overrides the built-in edit tool", () => {
    expect(tool.name).toBe("edit");
  });

  it("advertises replaceAll in the schema", () => {
    const edits = tool.parameters.properties.edits as {
      items: { properties: Record<string, unknown> };
    };
    expect(Object.keys(edits.items.properties)).toContain("replaceAll");
  });
});

describe("replaceAll", () => {
  it("rewrites every occurrence and reports the count", async () => {
    const path = fixture(
      "rename.ts",
      "getUser();\ngetUser();\nconst getUser = 1;\n",
    );
    const result = await run({
      path,
      edits: [{ oldText: "getUser", newText: "fetchUser", replaceAll: true }],
    });
    expect(result.content[0].text).toMatch(
      /Successfully replaced 3 occurrence\(s\)/,
    );
    expect(readFileSync(path, "utf-8")).toBe(
      "fetchUser();\nfetchUser();\nconst fetchUser = 1;\n",
    );
    expect(result.details?.diff).toBeTruthy();
  });

  it("preserves CRLF line endings", async () => {
    const path = fixture("crlf.ts", "a = 1\r\nb = 1\r\n");
    await run({
      path,
      edits: [{ oldText: "= 1", newText: "= 2", replaceAll: true }],
    });
    expect(readFileSync(path, "utf-8")).toBe("a = 2\r\nb = 2\r\n");
  });

  it("preserves a leading BOM", async () => {
    const path = fixture("bom.ts", "\uFEFFa = 1\na = 1\n");
    await run({
      path,
      edits: [{ oldText: "a = 1", newText: "a = 2", replaceAll: true }],
    });
    expect(readFileSync(path, "utf-8")).toBe("\uFEFFa = 2\na = 2\n");
  });

  it("accepts the snake_case spelling models emit", async () => {
    const path = fixture("snake.ts", "a();\na();\n");
    await run({
      path,
      edits: [{ oldText: "a()", newText: "b()", replace_all: true }],
    });
    expect(readFileSync(path, "utf-8")).toBe("b();\nb();\n");
  });

  it("accepts a legacy top-level call", async () => {
    const path = fixture("legacy.ts", "x = 1;\nx = 1;\n");
    await run({ path, oldText: "x = 1", newText: "y = 2", replaceAll: true });
    expect(readFileSync(path, "utf-8")).toBe("y = 2;\ny = 2;\n");
  });

  it("leaves the file untouched when an edit cannot be applied", async () => {
    const before = "a();\na();\n";
    const path = fixture("atomic.ts", before);
    await expect(
      run({
        path,
        edits: [
          { oldText: "a()", newText: "b()", replaceAll: true },
          { oldText: "missing", newText: "x" },
        ],
      }),
    ).rejects.toThrow(/Could not find edits\[1\]/);
    expect(readFileSync(path, "utf-8")).toBe(before);
  });
});

describe("delegation to the built-in tool", () => {
  it("applies a unique edit", async () => {
    const path = fixture("unique.ts", "const a = 1;\nconst b = 2;\n");
    const result = await run({
      path,
      edits: [{ oldText: "const b = 2;", newText: "const b = 3;" }],
    });
    expect(result.content[0].text).toMatch(
      /Successfully replaced 1 block\(s\)/,
    );
    expect(readFileSync(path, "utf-8")).toBe("const a = 1;\nconst b = 3;\n");
  });

  it("still applies whitespace-insensitive matches", async () => {
    const path = fixture("fuzzy.ts", "const label = \u201Chello\u201D;\n");
    await run({
      path,
      edits: [
        { oldText: 'const label = "hello";', newText: 'const label = "bye";' },
      ],
    });
    expect(readFileSync(path, "utf-8")).toContain("bye");
  });

  it("reports duplicate locations instead of a bare count", async () => {
    const path = fixture("dupes.ts", "get();\nget();\nget();\n");
    await expect(
      run({ path, edits: [{ oldText: "get()", newText: "put()" }] }),
    ).rejects.toThrow(
      /Found 3 occurrences of the text in .*at lines 1, 2, 3\..*replaceAll: true/s,
    );
  });

  it("leaves a missing file to the built-in error path", async () => {
    await expect(
      run({
        path: join(dir, "nope.ts"),
        edits: [{ oldText: "a", newText: "b" }],
      }),
    ).rejects.toThrow(/Could not edit file/);
  });
});
