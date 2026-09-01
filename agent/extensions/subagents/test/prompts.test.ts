import { describe, expect, it } from "vitest";
import type { EnvInfo } from "../env.ts";
import { buildAgentPrompt } from "../prompts.ts";
import type { AgentConfig } from "../types.ts";

const ENV: EnvInfo = {
  isGitRepo: true,
  branch: "main",
  platform: "darwin",
};

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "reviewer",
    filePath: "/agents/reviewer.md",
    description: "reviews things",
    allowTools: ["read", "grep"],
    systemPrompt: "AGENT_BODY",
    promptMode: "replace",
    ...overrides,
  };
}

const build = (config: AgentConfig) =>
  buildAgentPrompt(config, "/work", ENV, "PARENT_PROMPT");

describe("buildAgentPrompt", () => {
  it.each(["replace", "append"] as const)(
    "tags the active agent, environment, and instructions in %s mode",
    (promptMode) => {
      const prompt = build(agent({ promptMode }));
      expect(prompt).toContain('<active_agent name="reviewer"/>');
      expect(prompt).toContain("Working directory: /work");
      expect(prompt).toContain("Branch: main");
      expect(prompt).toContain("AGENT_BODY");
    },
  );

  it("leads append mode with the parent prompt verbatim, for a shared cache prefix", () => {
    expect(
      build(agent({ promptMode: "append" })).startsWith("PARENT_PROMPT"),
    ).toBe(true);
  });

  it("omits the parent prompt entirely in replace mode", () => {
    expect(build(agent({ promptMode: "replace" }))).not.toContain(
      "PARENT_PROMPT",
    );
  });

  it("says nothing about turns: a child cannot track its own budget", () => {
    for (const promptMode of ["replace", "append"] as const) {
      const prompt = build(agent({ promptMode }));
      expect(prompt).not.toMatch(/turn/i);
    }
  });

  it("tolerates an agent with no instructions of its own", () => {
    const prompt = build(agent({ systemPrompt: "" }));
    expect(prompt).toContain('<active_agent name="reviewer"/>');
    expect(prompt).not.toContain("AGENT_BODY");
  });
});
