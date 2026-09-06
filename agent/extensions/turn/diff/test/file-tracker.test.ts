import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import turnDiffExtension from "../index.ts";
import {
  captureFile,
  displayPath,
  summarizeFiles,
  type TrackedFile,
  type TurnDiffData,
} from "../file-tracker.ts";
import { composeReviewFeedback } from "../hunk-viewer.ts";

async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test("summarizes and patches line changes without a Git repository", async ({
  onTestFinished,
}) => {
  const cwd = await temporaryDirectory("pi-turn-diff-nonrepo-");
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  const filePath = path.join(cwd, "notes.txt");
  await writeFile(filePath, "one\ntwo\nthree\n");
  const before = await captureFile(filePath);
  assert.equal(before.status, "captured");
  if (before.status !== "captured") return;

  await writeFile(filePath, "one\nchanged\nthree\nfour\n");
  const tracked: TrackedFile = {
    absolutePath: filePath,
    displayPath: "notes.txt",
    before: before.snapshot,
  };
  const result = await summarizeFiles(cwd, [tracked]);

  assert.equal(result.data?.version, 3);
  assert.equal(result.data?.cwd, cwd);
  assert.deepEqual(result.data?.files, [
    {
      path: "notes.txt",
      patchPath: "notes.txt",
      additions: 2,
      deletions: 1,
    },
  ]);
  assert.equal(result.data?.additions, 2);
  assert.equal(result.data?.deletions, 1);
  assert.equal(result.data?.patchTruncated, false);
  assert.match(
    result.data?.patch ?? "",
    /^diff --git a\/notes\.txt b\/notes\.txt/m,
  );
  assert.match(result.data?.patch ?? "", /-two\n\+changed/);
  assert.deepEqual(result.warnings, []);
});

test("counts and patches creation of an empty file", async ({
  onTestFinished,
}) => {
  const cwd = await temporaryDirectory("pi-turn-diff-create-");
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  const filePath = path.join(cwd, "empty.txt");
  const before = await captureFile(filePath);
  assert.equal(before.status, "captured");
  if (before.status !== "captured") return;

  await writeFile(filePath, "");
  const result = await summarizeFiles(cwd, [
    {
      absolutePath: filePath,
      displayPath: "empty.txt",
      before: before.snapshot,
    },
  ]);

  assert.deepEqual(result.data?.files, [
    {
      path: "empty.txt",
      patchPath: "empty.txt",
      additions: 0,
      deletions: 0,
    },
  ]);
  assert.match(result.data?.patch ?? "", /new file mode 100644/);
  assert.match(
    result.data?.patch ?? "",
    /--- \/dev\/null\n\+\+\+ b\/empty\.txt/,
  );
});

test("displays paths outside the working directory as absolute", () => {
  assert.equal(
    displayPath("/tmp/outside.txt", "/workspace/project"),
    "/tmp/outside.txt",
  );
  assert.equal(
    displayPath("/workspace/project/src/a.ts", "/workspace/project"),
    "src/a.ts",
  );
});

test("records only successful edit and write tool targets", async ({
  onTestFinished,
}) => {
  const cwd = await temporaryDirectory("pi-turn-diff-cwd-");
  const outside = await temporaryDirectory("pi-turn-diff-outside-");
  onTestFinished(async () => {
    await Promise.all([
      rm(cwd, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  const changedPath = path.join(outside, "changed.txt");
  const failedPath = path.join(cwd, "failed.txt");
  await writeFile(changedPath, "before\n");
  await writeFile(failedPath, "untouched\n");

  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const entries: TurnDiffData[] = [];
  const pi = {
    registerEntryRenderer() {},
    registerCommand() {},
    on(name: string, handler: (event: any, ctx: any) => unknown) {
      handlers.set(name, handler);
    },
    appendEntry(_type: string, data: TurnDiffData) {
      entries.push(data);
    },
  } as unknown as ExtensionAPI;
  turnDiffExtension(pi);
  const ctx = { cwd, ui: { notify() {} } };

  await handlers.get("before_agent_start")?.({}, ctx);
  await handlers.get("tool_call")?.(
    {
      toolCallId: "write-1",
      toolName: "write",
      input: { path: changedPath, content: "after\nmore\n" },
    },
    ctx,
  );
  await handlers.get("tool_call")?.(
    {
      toolCallId: "edit-1",
      toolName: "edit",
      input: { path: failedPath, edits: [] },
    },
    ctx,
  );
  // Retries or queued continuations can start another agent loop before it settles.
  await handlers.get("before_agent_start")?.({}, ctx);
  await writeFile(changedPath, "after\nmore\n");
  await handlers.get("tool_result")?.(
    {
      toolCallId: "write-1",
      toolName: "write",
      input: {},
      content: [],
      details: undefined,
      isError: false,
    },
    ctx,
  );
  await handlers.get("tool_result")?.(
    {
      toolCallId: "edit-1",
      toolName: "edit",
      input: {},
      content: [],
      details: undefined,
      isError: true,
    },
    ctx,
  );
  await handlers.get("agent_settled")?.({}, ctx);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0]?.files, [
    {
      path: changedPath,
      patchPath: `absolute${changedPath}`,
      additions: 2,
      deletions: 1,
    },
  ]);
  assert.match(entries[0]?.patch ?? "", new RegExp(`b/absolute${changedPath}`));
});

test("renders the last-turn label and caps the card at five files", () => {
  let renderer: any;
  const pi = {
    registerEntryRenderer(_type: string, value: any) {
      renderer = value;
    },
    registerCommand() {},
    on() {},
  } as unknown as ExtensionAPI;
  turnDiffExtension(pi);
  const files = Array.from({ length: 7 }, (_, index) => ({
    path: `file-${index}.ts`,
    patchPath: `file-${index}.ts`,
    additions: 1,
    deletions: 0,
  }));
  const component = renderer(
    {
      data: {
        version: 3,
        cwd: "/tmp",
        files,
        additions: 7,
        deletions: 0,
        patch: "patch",
        patchTruncated: false,
      },
    },
    { expanded: true },
    {
      fg(_name: string, text: string) {
        return text;
      },
      bg(_name: string, text: string) {
        return text;
      },
    },
  );
  const rendered = component.render(120).join("\n");
  assert.match(rendered, /\[last turn\] Edited 7 files/);
  assert.match(rendered, /file-4\.ts/);
  assert.doesNotMatch(rendered, /file-5\.ts/);
  assert.match(rendered, /\.\.\. 2 more/);
});

test("formats Hunk user annotations as editable review feedback", () => {
  assert.equal(
    composeReviewFeedback([
      {
        noteId: "user:1",
        source: "user",
        filePath: "src/a.ts",
        body: "Handle the empty case.",
        newRange: [12, 12],
      },
      {
        noteId: "user:2",
        source: "user",
        filePath: "README.md",
        body: "Clarify this wording.",
        oldRange: [4, 4],
      },
    ]),
    [
      "Please address the following review feedback:",
      "",
      "1. src/a.ts:12 (current)",
      "   Handle the empty case.",
      "",
      "2. README.md:4 (before turn)",
      "   Clarify this wording.",
    ].join("\n"),
  );
});
