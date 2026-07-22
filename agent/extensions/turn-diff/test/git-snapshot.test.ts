import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { beginCapture, finishCapture, parseNumstat } from "../git-snapshot.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
}

async function createRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-turn-diff-test-"));
  await git(root, "init", "--quiet");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test User");
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  await git(root, "add", "tracked.txt");
  await git(root, "commit", "--quiet", "-m", "initial");
  return root;
}

test("captures net changes from a dirty baseline", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "tracked.txt"), "dirty before run\n");
  const capture = await beginCapture(root);

  await writeFile(path.join(root, "tracked.txt"), "changed during run\n");
  await writeFile(path.join(root, "new file.txt"), "new\n");
  const diff = await finishCapture(capture);

  assert.ok(diff);
  assert.equal(diff.files.length, 2);
  assert.match(diff.patch ?? "", /-dirty before run/);
  assert.match(diff.patch ?? "", /\+changed during run/);
  assert.doesNotMatch(diff.patch ?? "", /-base/);
  assert.match(diff.patch ?? "", /new file\.txt/);
});

test("does not mutate the real Git index", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "tracked.txt"), "staged baseline\n");
  await git(root, "add", "tracked.txt");
  const indexPath = await git(root, "rev-parse", "--git-path", "index");
  const absoluteIndex = path.isAbsolute(indexPath)
    ? indexPath
    : path.join(root, indexPath);
  const before = await readFile(absoluteIndex);

  const capture = await beginCapture(root);
  await writeFile(path.join(root, "tracked.txt"), "after\n");
  await finishCapture(capture);

  assert.deepEqual(await readFile(absoluteIndex), before);
  assert.equal(
    await git(root, "diff", "--cached", "--name-only"),
    "tracked.txt",
  );
});

test("captures renames, deletions, and ignored-file behavior", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(root, "delete.txt"), "delete me\n");
  await git(root, "add", ".gitignore", "delete.txt");
  await git(root, "commit", "--quiet", "-m", "fixtures");
  const capture = await beginCapture(root);

  await git(root, "mv", "tracked.txt", "renamed.txt");
  await rm(path.join(root, "delete.txt"));
  await writeFile(path.join(root, "ignored.txt"), "ignored\n");
  const diff = await finishCapture(capture);

  assert.ok(diff);
  assert.equal(
    diff.files.some((file) => file.path === "ignored.txt"),
    false,
  );
  assert.equal(
    diff.files.some((file) => file.path === "delete.txt"),
    true,
  );
  assert.equal(
    diff.files.some(
      (file) => file.path === "renamed.txt" && file.oldPath === "tracked.txt",
    ),
    true,
  );
});

test("returns null for net-zero changes", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const capture = await beginCapture(root);
  await writeFile(path.join(root, "tracked.txt"), "temporary\n");
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  assert.equal(await finishCapture(capture), null);
});

test("supports repositories without commits", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-turn-diff-unborn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "--quiet");
  const capture = await beginCapture(root);
  await writeFile(path.join(root, "first.txt"), "first\n");
  const diff = await finishCapture(capture);
  assert.ok(diff);
  assert.equal(diff.files[0]?.path, "first.txt");
});

test("keeps summaries when the patch exceeds the storage limit", async (t) => {
  const root = await createRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  const capture = await beginCapture(root);
  await writeFile(
    path.join(root, "large.txt"),
    "changed line\n".repeat(100_000),
  );
  const diff = await finishCapture(capture);

  assert.ok(diff);
  assert.equal(diff.patch, null);
  assert.equal(diff.patchTruncated, true);
  assert.equal(diff.files[0]?.path, "large.txt");
  assert.equal(diff.files[0]?.additions, 100_000);
});

test("parses regular, renamed, and binary numstat records", () => {
  const files = parseNumstat(
    "2\t1\ta.txt\0-\t-\tb.bin\0" + "0\t0\t\0old\0new\0",
  );
  assert.deepEqual(files, [
    {
      path: "a.txt",
      status: "M",
      additions: 2,
      deletions: 1,
      binary: false,
    },
    {
      path: "b.bin",
      status: "M",
      additions: null,
      deletions: null,
      binary: true,
    },
    {
      path: "new",
      oldPath: "old",
      status: "M",
      additions: 0,
      deletions: 0,
      binary: false,
    },
  ]);
});
