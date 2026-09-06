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

const scope = AVAILABLE.map((model) => ({
  model,
  thinkingLevel: undefined,
})) as ExtensionContext["scopedModels"];

describe("findModel", () => {
  it("treats no reference as no preference", () => {
    expect(findModel(undefined, scope)).toBeUndefined();
    expect(findModel("  ", scope)).toBeUndefined();
  });

  it("resolves an exact provider/id", () => {
    expect(findModel("openai-codex/gpt-5.6-sol", scope)).toBe(AVAILABLE[3]);
  });

  it("resolves a unique bare id substring", () => {
    expect(findModel("sonnet", scope)).toBe(AVAILABLE[0]);
  });

  it("resolves a unique provider-qualified substring", () => {
    expect(findModel("openai-codex/gpt-5.6-l", scope)).toBe(AVAILABLE[2]);
  });

  it("rejects an ambiguous substring", () => {
    expect(findModel("gpt-5.6", scope)).toBeUndefined();
  });

  it("returns no model when the session scope is empty", () => {
    expect(findModel("gpt-5.6-luna", [])).toBeUndefined();
    expect(suggestModels("gpt-5.6-luna", [])).toEqual([]);
  });

  it("returns undefined rather than a substitute for an unknown model", () => {
    // The effort-suffix form four spawns used in past sessions.
    expect(findModel("openai-codex/gpt-5.6-luna:xhigh", scope)).toBeUndefined();
    expect(findModel("gemini-3-pro", scope)).toBeUndefined();
  });
});

describe("suggestModels", () => {
  it("recovers the intended model from an effort suffix", () => {
    expect(suggestModels("openai-codex/gpt-5.6-luna:xhigh", scope)).toEqual([
      "openai-codex/gpt-5.6-luna",
    ]);
  });

  it("ranks the named provider first, then exact ids", () => {
    const crossProvider = [
      model("openai", "gpt-5.6-luna"),
      model("openrouter", "openai/gpt-5.6-luna-pro"),
      model("openai-codex", "gpt-5.6-luna"),
      model("openai-codex", "gpt-5.6-luna-pro"),
    ].map((model) => ({ model, thinkingLevel: undefined }));

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
    expect(suggestModels("openai/gpt-5.6-sol", scope)).toEqual([
      "openai-codex/gpt-5.6-sol",
    ]);
  });

  it("falls back to scoped models when nothing is close", () => {
    expect(suggestModels("gemini-3-pro", scope)).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5",
      "openai-codex/gpt-5.6-luna",
      "openai-codex/gpt-5.6-sol",
    ]);
  });
});
