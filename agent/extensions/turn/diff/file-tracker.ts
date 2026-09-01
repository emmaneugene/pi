import { spawn } from "node:child_process";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const MAX_PATCH_BYTES = 1024 * 1024;
const DIFF_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

export interface FileSnapshot {
  state: "missing" | "present";
  content: string;
}

export interface TrackedFile {
  absolutePath: string;
  displayPath: string;
  before: FileSnapshot;
}

export interface FileStats {
  path: string;
  patchPath: string;
  additions: number;
  deletions: number;
}

export interface TurnDiffData {
  version: 3;
  cwd: string;
  files: FileStats[];
  additions: number;
  deletions: number;
  patch: string | null;
  patchTruncated: boolean;
}

export type SnapshotResult =
  | { status: "captured"; snapshot: FileSnapshot }
  | { status: "failed"; message: string };

export function displayPath(absolutePath: string, cwd: string): string {
  const relative = path.relative(cwd, absolutePath);
  const insideCwd =
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
  return (insideCwd ? relative || "." : absolutePath).split(path.sep).join("/");
}

export async function captureFile(filePath: string): Promise<SnapshotResult> {
  try {
    return {
      status: "captured",
      snapshot: { state: "present", content: await readFile(filePath, "utf8") },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        status: "captured",
        snapshot: { state: "missing", content: "" },
      };
    }
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  outputLimited: boolean;
}

function runGitDiff(
  args: string[],
  maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--no-index", ...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputLimited = false;
    let settled = false;
    const finish = (result: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("git diff --no-index timed out")));
    }, DIFF_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        outputLimited = true;
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_PROCESS_OUTPUT_BYTES) stderr.push(chunk);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      finish(() =>
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          outputLimited,
        }),
      );
    });
  });
}

function requireDiffResult(result: ProcessResult): void {
  if (result.outputLimited) return;
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(result.stderr.trim() || "git diff --no-index failed");
  }
}

async function lineStats(
  oldPath: string,
  newPath: string,
): Promise<{ additions: number; deletions: number }> {
  const result = await runGitDiff([
    "--numstat",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--",
    oldPath,
    newPath,
  ]);
  requireDiffResult(result);
  if (result.outputLimited)
    throw new Error("git diff statistics exceeded 1 MB");
  if (!result.stdout) return { additions: 0, deletions: 0 };
  const [additions, deletions] = result.stdout.split("\t", 2);
  if (additions === "-" || deletions === "-") {
    return { additions: 0, deletions: 0 };
  }
  return {
    additions: Number.parseInt(additions ?? "0", 10),
    deletions: Number.parseInt(deletions ?? "0", 10),
  };
}

function quotePatchPath(filePath: string): string {
  return /[\s"\\]/u.test(filePath) ? JSON.stringify(filePath) : filePath;
}

function reviewPath(displayPath: string): string {
  if (displayPath.startsWith("/")) return `absolute${displayPath}`;
  if (/^[A-Za-z]:\//u.test(displayPath)) {
    return `absolute/${displayPath.replace(":/", "/")}`;
  }
  return displayPath;
}

function patchHeader(
  patchPath: string,
  before: FileSnapshot,
  after: FileSnapshot,
): string[] {
  const oldLabel = `a/${patchPath}`;
  const newLabel = `b/${patchPath}`;
  const lines = [
    `diff --git ${quotePatchPath(oldLabel)} ${quotePatchPath(newLabel)}`,
  ];
  if (before.state === "missing") lines.push("new file mode 100644");
  if (after.state === "missing") lines.push("deleted file mode 100644");
  lines.push(
    before.state === "missing"
      ? "--- /dev/null"
      : `--- ${quotePatchPath(oldLabel)}`,
    after.state === "missing"
      ? "+++ /dev/null"
      : `+++ ${quotePatchPath(newLabel)}`,
  );
  return lines;
}

async function unifiedPatch(
  oldPath: string,
  newPath: string,
  patchPath: string,
  before: FileSnapshot,
  after: FileSnapshot,
): Promise<{ patch: string | null; truncated: boolean }> {
  const result = await runGitDiff(
    [
      "--no-color",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      "--",
      oldPath,
      newPath,
    ],
    MAX_PATCH_BYTES,
  );
  requireDiffResult(result);
  if (result.outputLimited) return { patch: null, truncated: true };
  const lines = result.stdout.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  const body = firstHunk >= 0 ? lines.slice(firstHunk) : [];
  return {
    patch:
      [...patchHeader(patchPath, before, after), ...body].join("\n") + "\n",
    truncated: false,
  };
}

export async function summarizeFiles(
  cwd: string,
  trackedFiles: TrackedFile[],
): Promise<{ data: TurnDiffData | null; warnings: string[] }> {
  if (trackedFiles.length === 0) return { data: null, warnings: [] };
  const tempDir = await mkdtemp(path.join(tmpdir(), "pi-turn-diff-"));
  const files: FileStats[] = [];
  const patches: string[] = [];
  const warnings: string[] = [];
  let patchBytes = 0;
  let patchTruncated = false;
  try {
    for (const [index, tracked] of trackedFiles.entries()) {
      const current = await captureFile(tracked.absolutePath);
      if (current.status === "failed") {
        warnings.push(`${tracked.displayPath}: ${current.message}`);
        continue;
      }
      const after = current.snapshot;
      if (
        tracked.before.state === after.state &&
        tracked.before.content === after.content
      ) {
        continue;
      }

      const oldPath = path.join(tempDir, `${index}.old`);
      const newPath = path.join(tempDir, `${index}.new`);
      await Promise.all([
        writeFile(oldPath, tracked.before.content, "utf8"),
        writeFile(newPath, after.content, "utf8"),
      ]);
      const stats = await lineStats(oldPath, newPath);
      const patchPath = reviewPath(tracked.displayPath);
      files.push({ path: tracked.displayPath, patchPath, ...stats });

      if (!patchTruncated) {
        const generated = await unifiedPatch(
          oldPath,
          newPath,
          patchPath,
          tracked.before,
          after,
        );
        if (generated.truncated || !generated.patch) {
          patchTruncated = true;
          patches.length = 0;
        } else {
          patchBytes += Buffer.byteLength(generated.patch, "utf8");
          if (patchBytes > MAX_PATCH_BYTES) {
            patchTruncated = true;
            patches.length = 0;
          } else {
            patches.push(generated.patch);
          }
        }
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  if (files.length === 0) return { data: null, warnings };
  return {
    data: {
      version: 3,
      cwd,
      files,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      patch: patchTruncated ? null : patches.join(""),
      patchTruncated,
    },
    warnings,
  };
}
