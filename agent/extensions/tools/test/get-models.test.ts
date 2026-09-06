import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import getModelsExtension from "../get-models.ts";

interface GetModelsResult {
  details: {
    scopeSource: string;
    count: number;
    models: unknown[];
  };
}

function registeredTool() {
  let tool:
    | {
        execute: (
          id: string,
          params: Record<string, never>,
          signal: undefined,
          onUpdate: undefined,
          ctx: ExtensionContext,
        ) => Promise<GetModelsResult>;
      }
    | undefined;
  const pi = {
    registerTool: (registered: typeof tool) => {
      tool = registered;
    },
    getThinkingLevel: () => "medium",
  } as unknown as ExtensionAPI;
  getModelsExtension(pi);
  if (!tool) throw new Error("get_models was not registered");
  return tool;
}

describe("get_models", () => {
  it("returns no models when the session scope is empty", async () => {
    const tool = registeredTool();
    const ctx = {
      cwd: "/tmp",
      model: undefined,
      scopedModels: [],
      modelRegistry: {
        getAvailable: () => {
          throw new Error("global registry must not be read");
        },
      },
    } as unknown as ExtensionContext;

    const result = await tool.execute("call", {}, undefined, undefined, ctx);

    expect(result.details).toMatchObject({
      scopeSource: "session scopedModels",
      count: 0,
      models: [],
    });
  });
});
