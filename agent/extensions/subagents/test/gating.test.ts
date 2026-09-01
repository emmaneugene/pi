import { describe, expect, it } from "vitest";
import {
  BUILTIN_TOOLS,
  DENIED_TOOLS,
  filterActiveTools,
  isDeniedTool,
  resolveAllowedTools,
} from "../gating.ts";
import type { AgentConfig } from "../types.ts";

function config(allowTools?: string[]): AgentConfig {
  return {
    name: "test",
    filePath: "/agents/test.md",
    description: "test agent",
    systemPrompt: "test",
    promptMode: "replace",
    ...(allowTools === undefined ? {} : { allowTools }),
  };
}

/** Everything a bound child session might report as registered. */
const REGISTERED = [
  ...BUILTIN_TOOLS,
  "web_search",
  "get_models",
  ...DENIED_TOOLS,
];

describe("resolveAllowedTools", () => {
  it("returns undefined for a definition that omits tools, meaning every tool", () => {
    expect(resolveAllowedTools(config())).toBeUndefined();
  });

  it("returns an empty list for tools: none, which is not the same as omitted", () => {
    expect(resolveAllowedTools(config([]))).toEqual([]);
  });

  it("keeps an explicit list, de-duplicated", () => {
    expect(resolveAllowedTools(config(["read", "bash", "read"]))).toEqual([
      "read",
      "bash",
    ]);
  });

  it("strips a denied tool even when the definition names it explicitly", () => {
    expect(resolveAllowedTools(config(["read", "subagent"]))).toEqual(["read"]);
  });
});

describe("filterActiveTools", () => {
  it("grants everything except denied tools when there is no allowlist", () => {
    const result = filterActiveTools(REGISTERED, config());

    expect(result).toContain("bash");
    expect(result).toContain("web_search");
    expect(result).toContain("grep");
    for (const denied of DENIED_TOOLS) expect(result).not.toContain(denied);
  });

  it("never grants a subagent tool, so a child cannot spawn or steer children", () => {
    // This extension does not support recursive subagents: a child holding
    // `subagent` would spawn against the same concurrency limit, and abort does
    // not walk a tree.
    for (const allow of [undefined, ["subagent"], [...DENIED_TOOLS]]) {
      const result = filterActiveTools(REGISTERED, config(allow));
      expect(result).not.toContain("subagent");
      expect(result).not.toContain("steer_subagent");
      expect(result).not.toContain("get_subagent_result");
      expect(result).not.toContain("inspect_subagent");
    }
  });

  it("never grants AskUserQuestion, which has no UI to reach in a child", () => {
    expect(filterActiveTools(REGISTERED, config())).not.toContain(
      "AskUserQuestion",
    );
  });

  it("restricts to the allowlist when one is given", () => {
    expect(filterActiveTools(REGISTERED, config(["read", "grep"]))).toEqual([
      "read",
      "grep",
    ]);
  });

  it("grants nothing for tools: none", () => {
    expect(filterActiveTools(REGISTERED, config([]))).toEqual([]);
  });

  it("ignores an allowlist entry that is not registered", () => {
    expect(filterActiveTools(REGISTERED, config(["read", "nope"]))).toEqual([
      "read",
    ]);
  });
});

describe("isDeniedTool", () => {
  it("covers the whole subagent family and nothing else", () => {
    for (const name of DENIED_TOOLS) expect(isDeniedTool(name)).toBe(true);
    for (const name of BUILTIN_TOOLS) expect(isDeniedTool(name)).toBe(false);
    expect(isDeniedTool("web_search")).toBe(false);
  });
});
