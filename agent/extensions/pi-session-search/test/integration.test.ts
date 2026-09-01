import { strict as assert } from "node:assert";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readSessionWindow, searchSessions } from "../index.ts";

/**
 * Set up a temporary sessions root with a couple of fake JSONL session files
 * in it. Returns the root path so the caller can clean it up.
 */
function buildFixtureSessions(): {
  root: string;
  sessionFile: string;
  sessionId: string;
} {
  const root = mkdtempSync(join(tmpdir(), "pi-session-search-"));
  // Mimic pi's encoded-cwd directory naming scheme.
  const cwdDir = "--home-tester-project--";
  mkdirSync(join(root, cwdDir));
  const filename = "2026-04-23T06-48-02-781Z_session-1.jsonl";
  const sessionFile = join(root, cwdDir, filename);
  const sessionId = "session-1-id";
  const lines = [
    JSON.stringify({
      type: "session",
      id: sessionId,
      cwd: "/home/tester/project",
      timestamp: "2026-04-23T06:48:02.781Z",
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-04-23T06:48:10.000Z",
      message: {
        role: "user",
        content: "Have we ever discussed vault-overseer?",
      },
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-04-23T06:48:15.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Yes, the ExternalSecret error came up last week.",
          },
        ],
      },
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-04-23T06:48:30.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "list_pods", arguments: { ns: "default" } },
        ],
      },
    }),
  ];
  writeFileSync(sessionFile, lines.join("\n") + "\n", "utf-8");
  return { root, sessionFile, sessionId };
}

describe("searchSessions (integration)", () => {
  const original = process.env.PI_SESSION_SEARCH_ROOT;

  let fixture: ReturnType<typeof buildFixtureSessions>;

  beforeEach(() => {
    fixture = buildFixtureSessions();
    process.env.PI_SESSION_SEARCH_ROOT = fixture.root;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.PI_SESSION_SEARCH_ROOT;
    else process.env.PI_SESSION_SEARCH_ROOT = original;
  });

  it("finds substring matches in user messages", async () => {
    const r = await searchSessions({ query: "vault-overseer" });
    assert.ok(r.hits.length >= 1);
    const hit = r.hits[0];
    assert.equal(hit.role, "user");
    assert.match(hit.snippet, /vault-overseer/);
    assert.equal(hit.sessionId, fixture.sessionId);
    // sessionFile should be relative to the root, not absolute
    assert.ok(!hit.sessionFile.startsWith("/"));
  });

  it("filters by role", async () => {
    const userOnly = await searchSessions({
      query: "vault-overseer",
      role: "user",
    });
    assert.ok(userOnly.hits.length >= 1);
    assert.ok(userOnly.hits.every((h) => h.role === "user"));

    const assistantOnly = await searchSessions({
      query: "vault-overseer",
      role: "assistant",
    });
    assert.equal(assistantOnly.hits.length, 0);
  });

  it("respects --cwd substring filter", async () => {
    const matched = await searchSessions({
      query: "vault-overseer",
      cwd: "tester",
    });
    assert.ok(matched.hits.length >= 1);

    const missed = await searchSessions({
      query: "vault-overseer",
      cwd: "nonexistent",
    });
    assert.equal(missed.hits.length, 0);
  });

  it("respects since/until filtering using the filename timestamp", async () => {
    const before = await searchSessions({
      query: "vault-overseer",
      until: "2026-04-22T00:00:00Z",
    });
    assert.equal(
      before.hits.length,
      0,
      "session is from 2026-04-23, should be filtered out",
    );

    const after = await searchSessions({
      query: "vault-overseer",
      since: "2026-04-23T00:00:00Z",
    });
    assert.ok(after.hits.length >= 1);
  });

  it("optionally searches tool-call names/args", async () => {
    const without = await searchSessions({ query: "list_pods" });
    assert.equal(without.hits.length, 0, "tool calls hidden by default");

    const withTool = await searchSessions({
      query: "list_pods",
      includeToolCalls: true,
    });
    assert.ok(withTool.hits.length >= 1);
    assert.equal(withTool.hits[0].role, "toolCall");
  });

  it("excludes the current session when excludeSessionId matches the header id", async () => {
    const excluded = await searchSessions({
      query: "vault-overseer",
      excludeSessionId: fixture.sessionId,
    });
    assert.equal(excluded.hits.length, 0);
  });

  it("rejects an explicit maxResults=0 (silent coercion was a footgun)", async () => {
    await assert.rejects(
      () => searchSessions({ query: "vault-overseer", maxResults: 0 }),
      /must be an integer in \[1, 1000\]/,
    );
  });

  it("accepts maxResults=undefined (uses default)", async () => {
    const r = await searchSessions({ query: "vault-overseer" });
    assert.ok(r.hits.length >= 1);
  });

  it("skips a symlinked subdirectory that escapes the sessions root", async () => {
    // readdir({withFileTypes: true}).isDirectory() returns false for symlinks,
    // so symlinked subdirs are filtered before our realpath check even runs.
    // We still verify end-to-end: a symlinked subdir's content must not appear.
    const escaped = mkdtempSync(join(tmpdir(), "pi-session-escape-"));
    const escapedFile = join(escaped, "2026-04-23T07-00-00-000Z_evil.jsonl");
    writeFileSync(
      escapedFile,
      [
        JSON.stringify({ type: "session", id: "evil", cwd: "/elsewhere" }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-23T07:00:01Z",
          message: { role: "user", content: "vault-overseer outside" },
        }),
      ].join("\n"),
      "utf-8",
    );
    const symlinkPath = join(fixture.root, "--evil-symlink--");
    symlinkSync(escaped, symlinkPath, "dir");

    const r = await searchSessions({ query: "vault-overseer" });
    assert.equal(
      r.hits.length,
      1,
      "symlink-escaped sessions must not appear in results",
    );
    assert.equal(r.hits[0].sessionId, fixture.sessionId);
  });

  it("skips a symlinked .jsonl FILE that escapes the sessions root", async () => {
    // This is the more interesting attack vector: a regular subdir that
    // happens to contain a .jsonl symlinked outside the root. The original
    // implementation would have followed the symlink with readFile.
    const escaped = mkdtempSync(join(tmpdir(), "pi-session-file-escape-"));
    const escapedFile = join(escaped, "secret.jsonl");
    writeFileSync(
      escapedFile,
      [
        JSON.stringify({ type: "session", id: "smuggled", cwd: "/elsewhere" }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-23T07:00:01Z",
          message: { role: "user", content: "smuggled vault-overseer content" },
        }),
      ].join("\n"),
      "utf-8",
    );
    // Place a symlink to the escaped file inside the legitimate subdir.
    const symlinkInside = join(
      fixture.root,
      "--home-tester-project--",
      "2026-04-24T07-00-00-000Z_symlinked.jsonl",
    );
    symlinkSync(escapedFile, symlinkInside);

    const r = await searchSessions({ query: "smuggled" });
    assert.equal(
      r.hits.length,
      0,
      "a .jsonl symlinked outside the root must not be read",
    );
    assert.ok(
      r.skippedFiles >= 1,
      "skip count should reflect the rejected symlinked file",
    );
  });
});

describe("readSessionWindow (integration)", () => {
  const original = process.env.PI_SESSION_SEARCH_ROOT;
  const originalMax = process.env.PI_SESSION_SEARCH_MAX_BYTES;
  const originalMaxLine = process.env.PI_SESSION_SEARCH_MAX_LINE_BYTES;

  let fixture: ReturnType<typeof buildFixtureSessions>;

  beforeEach(() => {
    fixture = buildFixtureSessions();
    process.env.PI_SESSION_SEARCH_ROOT = fixture.root;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.PI_SESSION_SEARCH_ROOT;
    else process.env.PI_SESSION_SEARCH_ROOT = original;
    if (originalMax === undefined)
      delete process.env.PI_SESSION_SEARCH_MAX_BYTES;
    else process.env.PI_SESSION_SEARCH_MAX_BYTES = originalMax;
    if (originalMaxLine === undefined)
      delete process.env.PI_SESSION_SEARCH_MAX_LINE_BYTES;
    else process.env.PI_SESSION_SEARCH_MAX_LINE_BYTES = originalMaxLine;
  });

  it("returns a markdown-formatted window for an in-root path", async () => {
    const out = await readSessionWindow({ sessionFile: fixture.sessionFile });
    assert.match(out, /Session session-1-id/);
    assert.match(out, /vault-overseer/);
    assert.match(out, /ExternalSecret error/);
  });

  it("accepts a relative path from search_sessions", async () => {
    const rel =
      "--home-tester-project--/2026-04-23T06-48-02-781Z_session-1.jsonl";
    const out = await readSessionWindow({ sessionFile: rel });
    assert.match(out, /vault-overseer/);
  });

  it("centers the window around aroundTimestamp when provided", async () => {
    const out = await readSessionWindow({
      sessionFile: fixture.sessionFile,
      aroundTimestamp: "2026-04-23T06:48:15.000Z",
      contextMessages: 0,
      maxMessages: 1,
    });
    // With ctx=0 and max=1, only the assistant message should appear
    assert.match(out, /ExternalSecret error/);
    assert.ok(!out.includes("Have we ever discussed"));
  });

  it("refuses paths that escape the sessions root", async () => {
    await assert.rejects(
      () => readSessionWindow({ sessionFile: "/etc/passwd" }),
      /Refusing to read outside/,
    );
    await assert.rejects(
      () => readSessionWindow({ sessionFile: "../../../etc/passwd" }),
      /Refusing to read outside/,
    );
  });

  it("streams opening, centered, and final windows from a source larger than the byte cap", async () => {
    appendFileSync(
      fixture.sessionFile,
      [
        "{malformed-json",
        ...Array.from({ length: 20 }, (_, index) =>
          JSON.stringify({
            type: "custom",
            data: "x".repeat(200),
            index,
          }),
        ),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-23T06:49:00.000Z",
          message: { role: "user", content: "final readable message" },
        }),
      ].join("\n") + "\n",
    );
    process.env.PI_SESSION_SEARCH_MAX_BYTES = "1000";
    assert.ok(statSync(fixture.sessionFile).size > 1000);

    const opening = await readSessionWindow({
      sessionFile: fixture.sessionFile,
      maxMessages: 1,
    });
    assert.match(opening, /Have we ever discussed vault-overseer/);
    assert.ok(!opening.includes("ExternalSecret error"));

    const centered = await readSessionWindow({
      sessionFile: fixture.sessionFile,
      aroundTimestamp: "2026-04-23T06:48:15.000Z",
      contextMessages: 0,
      maxMessages: 1,
    });
    assert.match(centered, /ExternalSecret error/);
    assert.ok(!centered.includes("Have we ever discussed"));

    const final = await readSessionWindow({
      sessionFile: fixture.sessionFile,
      aroundTimestamp: "2099-01-01T00:00:00.000Z",
      contextMessages: 0,
      maxMessages: 1,
    });
    assert.match(final, /final readable message/);
  });

  it("caps an oversized returned window with an explicit notice", async () => {
    process.env.PI_SESSION_SEARCH_MAX_BYTES = "200";
    const out = await readSessionWindow({ sessionFile: fixture.sessionFile });
    assert.ok(Buffer.byteLength(out, "utf8") <= 200);
    assert.match(out, /Output truncated at PI_SESSION_SEARCH_MAX_BYTES/);
  });

  it("uses the complete output cap when no truncation notice is needed", async () => {
    const options = { sessionFile: fixture.sessionFile, maxMessages: 1 };
    const uncapped = await readSessionWindow(options);
    process.env.PI_SESSION_SEARCH_MAX_BYTES = String(
      Buffer.byteLength(uncapped, "utf8"),
    );
    const capped = await readSessionWindow(options);
    assert.equal(capped, uncapped);
    assert.ok(!capped.includes("Output truncated"));
  });

  it("rejects a single JSONL record that crosses stream chunks and the line-memory cap", async () => {
    const maxLineBytes = 70 * 1024;
    process.env.PI_SESSION_SEARCH_MAX_LINE_BYTES = String(maxLineBytes);
    appendFileSync(
      fixture.sessionFile,
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-23T06:49:00.000Z",
        message: { role: "user", content: "x".repeat(80 * 1024) },
      }) + "\n",
    );
    await assert.rejects(
      () => readSessionWindow({ sessionFile: fixture.sessionFile }),
      new RegExp(
        `record larger than PI_SESSION_SEARCH_MAX_LINE_BYTES \\(${maxLineBytes}\\)`,
      ),
    );
  });

  it("parses a final JSONL record without a trailing newline", async () => {
    appendFileSync(
      fixture.sessionFile,
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-23T06:49:00.000Z",
        message: { role: "user", content: "unterminated final record" },
      }),
    );
    const out = await readSessionWindow({
      sessionFile: fixture.sessionFile,
      aroundTimestamp: "2099-01-01T00:00:00.000Z",
      contextMessages: 0,
      maxMessages: 1,
    });
    assert.match(out, /unterminated final record/);
  });

  it("validates read-window counts and accepts the hard-cap boundary", async () => {
    await assert.rejects(
      () =>
        readSessionWindow({
          sessionFile: fixture.sessionFile,
          contextMessages: -1,
        }),
      /contextMessages must be an integer in \[0, 1000\]/,
    );
    await assert.rejects(
      () =>
        readSessionWindow({
          sessionFile: fixture.sessionFile,
          contextMessages: 1.5,
        }),
      /contextMessages must be an integer/,
    );
    await assert.rejects(
      () =>
        readSessionWindow({
          sessionFile: fixture.sessionFile,
          maxMessages: 1001,
        }),
      /maxMessages must be an integer in \[1, 1000\]/,
    );

    const out = await readSessionWindow({
      sessionFile: fixture.sessionFile,
      contextMessages: 1000,
      maxMessages: 1000,
    });
    assert.match(out, /vault-overseer/);
  });

  it("refuses a symlinked file that escapes the root, even by relative path", async () => {
    const escaped = mkdtempSync(join(tmpdir(), "pi-session-escape-"));
    const escapedFile = join(escaped, "secret.jsonl");
    writeFileSync(escapedFile, "{}", "utf-8");
    const symlinkPath = join(fixture.root, "--evil--", "leak.jsonl");
    mkdirSync(join(fixture.root, "--evil--"));
    symlinkSync(escapedFile, symlinkPath);

    await assert.rejects(
      () => readSessionWindow({ sessionFile: symlinkPath }),
      /Refusing to read outside/,
    );
  });
});
