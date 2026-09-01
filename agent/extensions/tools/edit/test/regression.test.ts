/**
 * Regressions from the review of the first implementation.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import register from "../index.ts";

type Tool = {
  prepareArguments?: (args: unknown) => unknown;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
};

let tool: Tool;
let dir: string;

beforeAll(() => {
  const registered: Tool[] = [];
  register({ registerTool: (t: Tool) => registered.push(t) } as never);
  tool = registered[0];
  dir = mkdtempSync(join(tmpdir(), "edit-regression-"));
});

const run = (params: unknown) =>
  tool.execute(
    "call-1",
    tool.prepareArguments?.(params) ?? params,
    undefined,
    undefined,
    {},
  );

function fixture(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("concurrent edits to the same file", () => {
  it("does not reject a second edit against pre-edit content", async () => {
    // Both calls are issued before either completes, as pi's parallel tool
    // execution allows. The first removes one of the two duplicates, so the
    // second is unambiguous by the time it holds the mutation queue.
    const path = fixture("race.txt", "x\nx\n");
    const [first, second] = await Promise.allSettled([
      run({ path, edits: [{ oldText: "x\nx", newText: "y\nx" }] }),
      run({ path, edits: [{ oldText: "x", newText: "z" }] }),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    expect(readFileSync(path, "utf-8")).toBe("y\nz\n");
  });

  it("refuses a replaceAll computed from content that changed underneath it", async () => {
    const path = fixture("stale.txt", "a\na\n");
    const results = await Promise.allSettled([
      run({ path, edits: [{ oldText: "a", newText: "b", replaceAll: true }] }),
      run({
        path,
        edits: [{ oldText: "a\na\n", newText: "totally different\n" }],
      }),
    ]);
    // Whichever lands second must fail loudly rather than clobber the winner.
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures).toHaveLength(1);
    const content = readFileSync(path, "utf-8");
    expect(["b\nb\n", "totally different\n"]).toContain(content);
  });
});

describe("path resolution", () => {
  it("does not trim significant trailing whitespace into a different file", async () => {
    const bystander = fixture("target", "keep\nkeep\n");
    const intended = fixture("target ", "edit\nedit\n");
    await run({
      path: intended,
      edits: [{ oldText: "edit", newText: "done", replaceAll: true }],
    });
    expect(readFileSync(intended, "utf-8")).toBe("done\ndone\n");
    expect(readFileSync(bystander, "utf-8")).toBe("keep\nkeep\n");
  });
});

describe("ambiguity reporting", () => {
  it("locates duplicates that only the whitespace-insensitive matcher sees", async () => {
    // Smart quotes make line 1 byte-distinct from oldText but fuzzy-equal to it,
    // so only the whitespace-insensitive matcher sees two occurrences.
    const path = fixture(
      "fuzzy-dupes.ts",
      'const a = \u201Chi\u201D;\nconst a = "hi";\n',
    );
    await expect(
      run({ path, edits: [{ oldText: 'const a = "hi";', newText: "x" }] }),
    ).rejects.toThrow(/at lines 1, 2\./);
  });

  it("always names replaceAll as the alternative, even when it cannot locate the lines", async () => {
    const path = fixture("dupes2.ts", "q();\nq();\n");
    await expect(
      run({ path, edits: [{ oldText: "q()", newText: "r()" }] }),
    ).rejects.toThrow(/replaceAll: true/);
  });
});
