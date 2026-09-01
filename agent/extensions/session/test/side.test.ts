import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { buildPiStartupInput, createForkedSession } from "../side.ts";

const tempDirectories: string[] = [];

async function createSession() {
  const cwd = await mkdtemp(join(tmpdir(), "pi-side-test-"));
  tempDirectories.push(cwd);
  const sessionManager = SessionManager.create(cwd, join(cwd, "sessions"));

  sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: Date.now(),
  });
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "world" }],
    provider: "test",
    model: "test",
    api: "openai-completions",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });

  return { cwd, sessionManager };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("buildPiStartupInput", () => {
  it("passes the session file and prompt as shell arguments", () => {
    const input = buildPiStartupInput("/tmp/session file.jsonl", "say 'hello'");

    expect(input).toContain("'--session' '/tmp/session file.jsonl'");
    expect(input).toContain(`'say '"'"'hello'"'"''`);
    expect(input).not.toContain("'--'");
    expect(input.endsWith("\n")).toBe(true);
  });

  it("keeps option-like prompts as messages", () => {
    const input = buildPiStartupInput("/tmp/session.jsonl", "--check @file");

    expect(input).toContain(`' --check @file'`);
  });

  it("omits the prompt argument entirely when empty", () => {
    const input = buildPiStartupInput("/tmp/session.jsonl", "");

    expect(input.trimEnd()).toMatch(/'--session' '\/tmp\/session\.jsonl'$/);
    expect(input.endsWith("\n")).toBe(true);
  });
});

describe("createForkedSession", () => {
  it("copies the active path without switching the live manager", async () => {
    const { cwd, sessionManager } = await createSession();
    const sourceFile = sessionManager.getSessionFile();
    const leafId = sessionManager.getLeafId();

    expect(sourceFile).toBeDefined();
    expect(leafId).toBeDefined();

    const forkedFile = createForkedSession(sourceFile!, leafId!);

    expect(forkedFile).toBeDefined();
    expect(forkedFile).not.toBe(sourceFile);
    expect(sessionManager.getSessionFile()).toBe(sourceFile);

    const entries = (await readFile(forkedFile!, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      type: "session",
      parentSession: sourceFile,
      cwd,
    });
    expect(entries.slice(1)).toEqual(sessionManager.getBranch());
  });

  it("snapshots an earlier completed turn instead of the full branch", async () => {
    const { sessionManager } = await createSession();
    const sourceFile = sessionManager.getSessionFile();
    // Last entry of the first, completed turn: a valid fork checkpoint.
    const checkpointLeafId = sessionManager.getLeafId()!;

    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "a later message" }],
      timestamp: Date.now(),
    });

    const forkedFile = createForkedSession(sourceFile!, checkpointLeafId);

    const entries = (await readFile(forkedFile!, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    // header + the two-message first turn, not the later message.
    expect(entries).toHaveLength(3);
    expect(entries[entries.length - 1]).toMatchObject({ id: checkpointLeafId });
  });
});
