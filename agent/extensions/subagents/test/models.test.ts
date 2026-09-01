import type { Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { findModel, suggestModels } from "../models.ts";

const model = (provider: string, id: string) =>
  ({ provider, id }) as unknown as Model<any>;

const AVAILABLE = [
  model("anthropic", "claude-sonnet-5"),
  model("anthropic", "claude-opus-5"),
  model("openai-codex", "gpt-5.6-luna"),
  model("openai-codex", "gpt-5.6-sol"),
];

const registry = {
  getAvailable: () => AVAILABLE,
  find: (provider: string, id: string) =>
    AVAILABLE.find((m) => m.provider === provider && m.id === id),
} as unknown as ExtensionContext["modelRegistry"];

describe("findModel", () => {
  it("treats no reference as no preference", () => {
    expect(findModel(undefined, registry)).toBeUndefined();
    expect(findModel("  ", registry)).toBeUndefined();
  });

  it("resolves an exact provider/id", () => {
    expect(findModel("openai-codex/gpt-5.6-sol", registry)).toBe(AVAILABLE[3]);
  });

  it("resolves a bare id substring", () => {
    expect(findModel("sonnet", registry)).toBe(AVAILABLE[0]);
  });

  it("resolves a provider-qualified substring the exact lookup misses", () => {
    expect(findModel("openai-codex/gpt-5.6-l", registry)).toBe(AVAILABLE[2]);
  });

  it("returns undefined rather than a substitute for an unknown model", () => {
    // The effort-suffix form four spawns used in past sessions.
    expect(
      findModel("openai-codex/gpt-5.6-luna:xhigh", registry),
    ).toBeUndefined();
    expect(findModel("gemini-3-pro", registry)).toBeUndefined();
  });
});

describe("suggestModels", () => {
  it("recovers the intended model from an effort suffix", () => {
    expect(suggestModels("openai-codex/gpt-5.6-luna:xhigh", registry)).toEqual([
      "openai-codex/gpt-5.6-luna",
    ]);
  });

  it("ranks the named provider first, then exact ids", () => {
    // The live registry shape: one model id served by several providers.
    const crossProvider = {
      getAvailable: () => [
        model("openai", "gpt-5.6-luna"),
        model("openrouter", "openai/gpt-5.6-luna-pro"),
        model("openai-codex", "gpt-5.6-luna"),
        model("openai-codex", "gpt-5.6-luna-pro"),
      ],
      find: () => undefined,
    } as unknown as ExtensionContext["modelRegistry"];

    expect(
      suggestModels("openai-codex/gpt-5.6-luna:xhigh", crossProvider),
    ).toEqual([
      "openai-codex/gpt-5.6-luna",
      "openai-codex/gpt-5.6-luna-pro",
      "openai/gpt-5.6-luna",
      "openrouter/openai/gpt-5.6-luna-pro",
    ]);
  });

  it("recovers matches from a wrong provider prefix", () => {
    expect(suggestModels("openai/gpt-5.6-sol", registry)).toEqual([
      "openai-codex/gpt-5.6-sol",
    ]);
  });

  it("falls back to available models when nothing is close", () => {
    expect(suggestModels("gemini-3-pro", registry)).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5",
      "openai-codex/gpt-5.6-luna",
      "openai-codex/gpt-5.6-sol",
    ]);
  });
});
