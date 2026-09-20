import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import askUserQuestion from "../index.ts";

describe("AskUserQuestion registration", () => {
  it("registers a sequential tool so parallel calls cannot overlap dialogs", () => {
    const registered: Array<{ executionMode?: "sequential" | "parallel" }> = [];
    const pi = {
      registerTool: (tool: { executionMode?: "sequential" | "parallel" }) => {
        registered.push(tool);
      },
    } as Pick<ExtensionAPI, "registerTool"> as ExtensionAPI;

    askUserQuestion(pi);

    expect(registered).toHaveLength(1);
    expect(registered[0].executionMode).toBe("sequential");
  });
});
