import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CatalogArtifact, showCatalog } from "../tui/picker.ts";

/** A ctx whose picker opens the first entry's artefact once, then closes. */
function catalogCtx() {
  let opened = false;
  const editor = vi.fn(async () => undefined);
  const ctx = {
    mode: "tui",
    ui: {
      custom: async () => {
        if (opened) return undefined;
        opened = true;
        return { value: "one", action: "artifact" };
      },
      editor,
      notify: vi.fn(),
    },
  } as unknown as ExtensionContext;
  return { ctx, editor };
}

async function open(artifact: CatalogArtifact) {
  const { ctx, editor } = catalogCtx();
  await showCatalog(ctx, "Things", [
    { item: { label: "one", value: "one" }, artifact: () => artifact },
  ]);
  return editor;
}

describe("showCatalog builtin editor", () => {
  const env = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
  beforeEach(() => {
    delete process.env.VISUAL;
    delete process.env.EDITOR;
  });
  afterEach(() => {
    Object.assign(process.env, env);
  });

  it("shows generated text as-is", async () => {
    const editor = await open({ kind: "text", content: "hello" });
    expect(editor).toHaveBeenCalledWith("Things · one", "hello");
  });

  it("reads a file artefact when opening it", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "picker-")), "SKILL.md");
    writeFileSync(path, "# skill");
    const editor = await open({ kind: "file", path });
    expect(editor).toHaveBeenCalledWith("Things · one", "# skill");
  });
});
