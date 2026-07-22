import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const GIT_TIMEOUT_MS = 30_000;
export const MAX_PATCH_BYTES = 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  outputLimited: boolean;
}

export interface RepoCapture {
  repoRoot: string;
  cwd: string;
  tempDir: string;
  objectDir: string;
  repoObjectDir: string;
  baseTree: string;
  startedAt: number;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: string;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface TurnDiffData {
  version: 1;
  repoRoot: string;
  cwd: string;
  startedAt: number;
  finishedAt: number;
  baseTree: string;
  finalTree: string;
  files: DiffFile[];
  additions: number;
  deletions: number;
  patch: string | null;
  patchBytes: number;
  patchTruncated: boolean;
}

export class GitSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitSnapshotError";
  }
}

function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputLimited = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new GitSnapshotError(
          `${command} exceeded ${options.timeoutMs ?? GIT_TIMEOUT_MS} ms`,
        ),
      );
    }, options.timeoutMs ?? GIT_TIMEOUT_MS);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new GitSnapshotError(`${command} failed to start: ${error}`));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (outputLimited) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        outputLimited = true;
        child.kill("SIGKILL");
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= maxOutputBytes) return;
      stderrBytes += chunk.length;
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        outputLimited,
      });
    });

    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

async function runGit(
  cwd: string,
  args: string[],
  options: Omit<ProcessOptions, "cwd"> = {},
): Promise<ProcessResult> {
  return runProcess("git", args, { ...options, cwd });
}

function requireSuccess(result: ProcessResult, operation: string): string {
  if (result.code !== 0 || result.outputLimited) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new GitSnapshotError(
      detail ? `${operation}: ${detail}` : `${operation} failed`,
    );
  }
  return result.stdout.trim();
}

async function resolveRepo(cwd: string): Promise<{
  repoRoot: string;
  repoObjectDir: string;
  hasHead: boolean;
}> {
  const rootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const repoRoot = requireSuccess(rootResult, "resolve Git repository");

  const objectResult = await runGit(repoRoot, [
    "rev-parse",
    "--git-path",
    "objects",
  ]);
  const rawObjectDir = requireSuccess(
    objectResult,
    "resolve Git object directory",
  );
  const repoObjectDir = path.isAbsolute(rawObjectDir)
    ? rawObjectDir
    : path.resolve(repoRoot, rawObjectDir);
  const headResult = await runGit(repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD^{tree}",
  ]);
  if (headResult.code !== 0 && headResult.code !== 1) {
    requireSuccess(headResult, "resolve HEAD tree");
  }
  return { repoRoot, repoObjectDir, hasHead: headResult.code === 0 };
}

function captureEnv(
  capture: Pick<RepoCapture, "objectDir" | "repoObjectDir">,
  indexPath: string,
): NodeJS.ProcessEnv {
  const existingAlternates = process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  const alternates = [capture.repoObjectDir, existingAlternates]
    .filter((value): value is string => Boolean(value))
    .join(path.delimiter);
  return {
    ...process.env,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alternates,
    GIT_INDEX_FILE: indexPath,
    GIT_OBJECT_DIRECTORY: capture.objectDir,
  };
}

async function snapshotTree(
  capture: Pick<
    RepoCapture,
    "repoRoot" | "tempDir" | "objectDir" | "repoObjectDir"
  >,
  name: string,
  hasHead: boolean,
): Promise<string> {
  const indexPath = path.join(capture.tempDir, `index-${name}`);
  const env = captureEnv(capture, indexPath);
  const seed = await runGit(
    capture.repoRoot,
    hasHead ? ["read-tree", "HEAD"] : ["read-tree", "--empty"],
    { env },
  );
  requireSuccess(seed, "seed temporary Git index");
  const add = await runGit(capture.repoRoot, ["add", "-A", "--", "."], {
    env,
  });
  requireSuccess(add, "snapshot working tree");
  const tree = await runGit(capture.repoRoot, ["write-tree"], { env });
  return requireSuccess(tree, "write working-tree snapshot");
}

export async function beginCapture(cwd: string): Promise<RepoCapture> {
  const { repoRoot, repoObjectDir, hasHead } = await resolveRepo(cwd);
  const tempDir = await mkdtemp(path.join(tmpdir(), "pi-turn-diff-"));
  const objectDir = path.join(tempDir, "objects");
  await mkdir(objectDir, { recursive: true });
  const partial = { repoRoot, cwd, tempDir, objectDir, repoObjectDir };
  try {
    const baseTree = await snapshotTree(partial, "base", hasHead);
    return {
      ...partial,
      baseTree,
      startedAt: Date.now(),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function parseNameStatus(output: string): Map<
  string,
  {
    status: string;
    oldPath?: string;
  }
> {
  const tokens = output.split("\0");
  const result = new Map<string, { status: string; oldPath?: string }>();
  let index = 0;
  while (index < tokens.length) {
    let token = tokens[index++];
    if (!token) continue;
    let status = token;
    let firstPath: string | undefined;
    const tab = token.indexOf("\t");
    if (tab >= 0) {
      status = token.slice(0, tab);
      firstPath = token.slice(tab + 1);
    } else {
      firstPath = tokens[index++];
    }
    if (!firstPath) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const newPath = tokens[index++];
      if (newPath) result.set(newPath, { status, oldPath: firstPath });
    } else {
      result.set(firstPath, { status });
    }
  }
  return result;
}

export function parseNumstat(
  output: string,
  statuses = new Map<string, { status: string; oldPath?: string }>(),
): DiffFile[] {
  const tokens = output.split("\0");
  const files: DiffFile[] = [];
  let index = 0;
  while (index < tokens.length) {
    const record = tokens[index++];
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const additionsRaw = record.slice(0, firstTab);
    const deletionsRaw = record.slice(firstTab + 1, secondTab);
    let filePath = record.slice(secondTab + 1);
    let oldPath: string | undefined;
    if (!filePath) {
      oldPath = tokens[index++];
      filePath = tokens[index++] ?? "";
    }
    if (!filePath) continue;
    const status = statuses.get(filePath);
    const parsed: DiffFile = {
      path: filePath,
      status: status?.status ?? "M",
      additions:
        additionsRaw === "-" ? null : Number.parseInt(additionsRaw, 10),
      deletions:
        deletionsRaw === "-" ? null : Number.parseInt(deletionsRaw, 10),
      binary: additionsRaw === "-" || deletionsRaw === "-",
    };
    const previousPath = status?.oldPath ?? oldPath;
    if (previousPath !== undefined) parsed.oldPath = previousPath;
    files.push(parsed);
  }
  return files;
}

export async function finishCapture(
  capture: RepoCapture,
): Promise<TurnDiffData | null> {
  try {
    const headResult = await runGit(capture.repoRoot, [
      "rev-parse",
      "--verify",
      "--quiet",
      "HEAD^{tree}",
    ]);
    const hasHead = headResult.code === 0;
    if (!hasHead && headResult.code !== 1) {
      requireSuccess(headResult, "resolve final HEAD tree");
    }
    const finalTree = await snapshotTree(capture, "final", hasHead);
    if (capture.baseTree === finalTree) return null;

    const env = captureEnv(capture, path.join(capture.tempDir, "index-diff"));
    const comparison = [capture.baseTree, finalTree, "--"];
    const [patchResult, numstatResult, statusResult] = await Promise.all([
      runGit(
        capture.repoRoot,
        [
          "diff",
          "--binary",
          "--full-index",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--find-renames",
          ...comparison,
        ],
        { env, maxOutputBytes: MAX_PATCH_BYTES },
      ),
      runGit(
        capture.repoRoot,
        ["diff", "--numstat", "-z", "--find-renames", ...comparison],
        { env },
      ),
      runGit(
        capture.repoRoot,
        ["diff", "--name-status", "-z", "--find-renames", ...comparison],
        { env },
      ),
    ]);
    const numstat = requireSuccess(numstatResult, "collect diff statistics");
    const nameStatus = requireSuccess(statusResult, "collect changed paths");
    const files = parseNumstat(numstat, parseNameStatus(nameStatus));
    const patchTruncated = patchResult.outputLimited;
    if (!patchTruncated && patchResult.code !== 0) {
      requireSuccess(patchResult, "render turn diff");
    }
    const patch = patchTruncated ? null : patchResult.stdout;
    return {
      version: 1,
      repoRoot: capture.repoRoot,
      cwd: capture.cwd,
      startedAt: capture.startedAt,
      finishedAt: Date.now(),
      baseTree: capture.baseTree,
      finalTree,
      files,
      additions: files.reduce(
        (total, file) => total + (file.additions ?? 0),
        0,
      ),
      deletions: files.reduce(
        (total, file) => total + (file.deletions ?? 0),
        0,
      ),
      patch,
      patchBytes: patchTruncated
        ? MAX_PATCH_BYTES + 1
        : Buffer.byteLength(patch ?? "", "utf8"),
      patchTruncated,
    };
  } finally {
    await cleanupCapture(capture);
  }
}

export async function cleanupCapture(capture: RepoCapture): Promise<void> {
  await rm(capture.tempDir, { recursive: true, force: true });
}
