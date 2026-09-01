import { describe, expect, it } from "vitest";
import {
  applyEdits,
  findAllOccurrences,
  lineOfOffset,
  locateOccurrences,
  parseDuplicateError,
  planReplacements,
  stripBom,
} from "../replace.ts";

const FILE = [
  "const a = getUser();",
  "const b = getUser();",
  "",
  "export function getUser() {",
  "\treturn 1;",
  "}",
  "",
].join("\n");

describe("findAllOccurrences", () => {
  it("returns every non-overlapping offset", () => {
    expect(findAllOccurrences("aaaa", "aa")).toEqual([0, 2]);
  });

  it("returns nothing for an empty needle", () => {
    expect(findAllOccurrences("abc", "")).toEqual([]);
  });
});

describe("lineOfOffset", () => {
  it("is 1-based and counts newlines before the offset", () => {
    expect(lineOfOffset(FILE, 0)).toBe(1);
    expect(lineOfOffset(FILE, FILE.indexOf("export"))).toBe(4);
  });
});

describe("duplicate reporting", () => {
  it("names every occurrence line and the replaceAll alternative", () => {
    expect(() =>
      planReplacements(
        FILE,
        [{ oldText: "getUser()", newText: "fetchUser()" }],
        "src/a.ts",
      ),
    ).toThrow(
      /Found 3 occurrences of the text in src\/a\.ts at lines 1, 2, 4\..*edits\[0\]\.replaceAll: true to rewrite all 3/s,
    );
  });

  it("indexes the offending edit when several were sent", () => {
    const edits = [
      { oldText: "return 1;", newText: "return 2;" },
      { oldText: "getUser()", newText: "fetchUser()" },
    ];
    expect(() => planReplacements(FILE, edits, "src/a.ts")).toThrow(
      /Found 3 occurrences of edits\[1\].*edits\[1\]\.replaceAll: true/s,
    );
  });

  it("caps the reported lines and counts the remainder", () => {
    const content = Array.from({ length: 15 }, () => "x").join("\n");
    expect(() =>
      planReplacements(content, [{ oldText: "x", newText: "y" }], "a.txt"),
    ).toThrow(/at lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, \+5 more/);
  });
});

describe("locateOccurrences", () => {
  it("locates exact duplicates", () => {
    expect(locateOccurrences(FILE, "getUser()")).toEqual([1, 2, 4]);
  });

  it("finds nothing for text that is absent", () => {
    expect(locateOccurrences(FILE, "nothing here")).toEqual([]);
  });

  it("falls back to the whitespace-insensitive scan", () => {
    // Line 1 differs from oldText only by smart quotes, so an exact scan sees one
    // occurrence while the built-in matcher sees two.
    const content = 'a = \u201Chi\u201D;\na = "hi";\n';
    expect(locateOccurrences(content, 'a = "hi";')).toEqual([1, 2]);
  });
});

describe("parseDuplicateError", () => {
  it("reads the count and edit index from the built-in messages", () => {
    expect(
      parseDuplicateError(
        "Found 3 occurrences of the text in a.ts. The text must be unique.",
      ),
    ).toEqual({
      count: 3,
      editIndex: 0,
    });
    expect(
      parseDuplicateError(
        "Found 12 occurrences of edits[2] in a.ts. Each oldText must be unique.",
      ),
    ).toEqual({
      count: 12,
      editIndex: 2,
    });
  });

  it("ignores every other error", () => {
    expect(
      parseDuplicateError("Could not find the exact text in a.ts."),
    ).toBeUndefined();
    expect(
      parseDuplicateError("Could not edit file: a.ts. Error code: ENOENT."),
    ).toBeUndefined();
  });
});

describe("applyEdits", () => {
  it("rewrites every occurrence with replaceAll", () => {
    const result = applyEdits(
      FILE,
      [{ oldText: "getUser()", newText: "fetchUser()", replaceAll: true }],
      "a.ts",
    );
    expect(result.replacements).toBe(3);
    expect(result.newContent).not.toMatch(/getUser\(\)/);
    expect(findAllOccurrences(result.newContent, "fetchUser()")).toHaveLength(
      3,
    );
  });

  it("mixes a replaceAll edit with a unique edit in one call", () => {
    const result = applyEdits(
      FILE,
      [
        { oldText: "getUser()", newText: "fetchUser()", replaceAll: true },
        { oldText: "return 1;", newText: "return 2;" },
      ],
      "a.ts",
    );
    expect(result.replacements).toBe(4);
    expect(result.newContent).toContain("return 2;");
  });

  it("rejects overlapping edits across entries", () => {
    expect(() =>
      applyEdits(
        "alpha beta",
        [
          { oldText: "alpha be", newText: "x" },
          { oldText: "a beta", newText: "y" },
        ],
        "a.txt",
      ),
    ).toThrow(/overlap/);
  });

  it("rejects a replacement that changes nothing", () => {
    expect(() =>
      applyEdits(
        FILE,
        [{ oldText: "getUser()", newText: "getUser()", replaceAll: true }],
        "a.ts",
      ),
    ).toThrow(/No changes made/);
  });

  it("reports a missing oldText without pretending to fuzzy match", () => {
    expect(() =>
      applyEdits(
        FILE,
        [{ oldText: "getUser ()", newText: "x", replaceAll: true }],
        "a.ts",
      ),
    ).toThrow(/Could not find the text in a\.ts/);
  });

  it("rejects an empty oldText", () => {
    expect(() =>
      applyEdits(
        FILE,
        [{ oldText: "", newText: "x", replaceAll: true }],
        "a.ts",
      ),
    ).toThrow(/must not be empty/);
  });

  it("strips a BOM before matching", () => {
    expect(stripBom("\uFEFFa")).toBe("a");
    expect(stripBom("a")).toBe("a");
  });
});
