import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveToolPath, resolveUserPath } from "../paths.ts";

const CWD = "/tmp/project";

describe("resolveToolPath", () => {
  it("resolves relative paths against cwd", () => {
    expect(resolveToolPath("src/a.ts", CWD)).toBe("/tmp/project/src/a.ts");
    expect(resolveToolPath("./src/a.ts", CWD)).toBe("/tmp/project/src/a.ts");
    expect(resolveToolPath("../sibling/b.ts", CWD)).toBe("/tmp/sibling/b.ts");
  });

  it("keeps absolute paths", () => {
    expect(resolveToolPath("/abs/c.ts", CWD)).toBe("/abs/c.ts");
  });

  it("strips a leading @, as the built-in tools do for @file paths", () => {
    expect(resolveToolPath("@src/a.ts", CWD)).toBe("/tmp/project/src/a.ts");
  });

  it("expands ~ and ~/", () => {
    expect(resolveToolPath("~", CWD)).toBe(homedir());
    expect(resolveToolPath("~/a.ts", CWD)).toBe(join(homedir(), "a.ts"));
  });

  it("treats ~name literally rather than as another user's home", () => {
    expect(resolveToolPath("~someone", CWD)).toBe("/tmp/project/~someone");
  });

  it("converts file:// URLs", () => {
    expect(resolveToolPath("file:///abs/url.ts", CWD)).toBe("/abs/url.ts");
  });

  it("normalizes Unicode spaces to ASCII spaces", () => {
    expect(resolveToolPath("a\u00A0b.ts", CWD)).toBe("/tmp/project/a b.ts");
    expect(resolveToolPath("a\u2009b.ts", CWD)).toBe("/tmp/project/a b.ts");
  });

  /**
   * The built-in tools do not pass `trim`, so trailing whitespace is part of the
   * filename. Trimming here would resolve to a different file: an earlier
   * version of this helper did, and edited the wrong one.
   */
  it("does not trim significant whitespace", () => {
    expect(resolveToolPath("target ", CWD)).toBe("/tmp/project/target ");
    expect(resolveToolPath(" target.ts", CWD)).toBe("/tmp/project/ target.ts");
  });
});

describe("resolveUserPath", () => {
  it("resolves relative paths and expands ~", () => {
    expect(resolveUserPath(CWD, "a.ts")).toBe("/tmp/project/a.ts");
    expect(resolveUserPath(CWD, "~")).toBe(homedir());
    expect(resolveUserPath(CWD, "~/a.ts")).toBe(join(homedir(), "a.ts"));
  });

  it("leaves @ and file:// alone, unlike the tool resolver", () => {
    expect(resolveUserPath(CWD, "@a.ts")).toBe("/tmp/project/@a.ts");
  });
});
