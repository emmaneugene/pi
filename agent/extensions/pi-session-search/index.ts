import {
  type AgentToolResult,
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  keyText,
  type ToolRenderResultOptions,
  truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const DEFAULT_ROOT = path.join(homedir(), CONFIG_DIR_NAME, "agent", "sessions");
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB search/output cap
const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024; // 16 MB per JSONL record
const DEFAULT_SNIPPET_BEFORE = 120;
const DEFAULT_SNIPPET_AFTER = 240;
const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_HARD_CAP = 1000;
const MAX_READ_MESSAGES_HARD_CAP = 1000;
const READ_TRUNCATION_NOTICE =
  "\n\n> Output truncated at PI_SESSION_SEARCH_MAX_BYTES. Narrow the window or raise the limit.\n";
// Per-message haystack cap before running the user-supplied regex. Bounds the
// worst case for a pathological pattern (catastrophic backtracking). It does
// NOT bound an exponentially-backtracking regex within those 256KB; we rely
// on the local-trust threat model and document the limitation in the README.
const MAX_HAYSTACK_BYTES = 256 * 1024;
const COLLAPSED_RESULT_LINES = 8;

interface RenderTheme {
  fg(name: string, text: string): string;
}

class ExpandableResultText {
  private readonly content: string;
  private readonly hint: string;
  private readonly expanded: boolean;
  private readonly collapsedLines: number;

  constructor(
    text: string,
    expanded: boolean,
    collapsedLines: number,
    theme: RenderTheme,
  ) {
    this.content = theme.fg("toolOutput", text);
    this.hint = theme.fg(
      "muted",
      `…\n(${keyText("app.tools.expand")} to expand)`,
    );
    this.expanded = expanded;
    this.collapsedLines = collapsedLines;
  }

  render(width: number): string[] {
    const lines = truncateToVisualLines(
      this.content,
      Number.MAX_SAFE_INTEGER,
      width,
    ).visualLines;
    if (this.expanded || lines.length <= this.collapsedLines) return lines;
    const hint = truncateToVisualLines(
      this.hint,
      Number.MAX_SAFE_INTEGER,
      width,
    ).visualLines;
    return [...lines.slice(0, this.collapsedLines), ...hint];
  }

  invalidate(): void {}
}

function sanitizeDisplayText(text: string): string {
  return Array.from(stripVTControlCharacters(text))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return false;
      if (codePoint === 0x09 || codePoint === 0x0a) return true;
      if (codePoint <= 0x1f) return false;
      return codePoint < 0xfff9 || codePoint > 0xfffb;
    })
    .join("")
    .replace(/\r/gu, "");
}

export function renderExpandableSessionResult(
  result: Pick<AgentToolResult<unknown>, "content">,
  options: ToolRenderResultOptions,
  theme: RenderTheme,
  context: { isError: boolean },
): ExpandableResultText {
  const text = result.content
    .flatMap((block): string[] =>
      block.type === "text"
        ? [sanitizeDisplayText(block.text)]
        : [`[image: ${block.mimeType}]`],
    )
    .join("\n");
  return new ExpandableResultText(
    text,
    options.expanded || context.isError,
    COLLAPSED_RESULT_LINES,
    theme,
  );
}

export function parseDateOrThrow(
  value: string | undefined,
  label: string,
): number {
  if (!value) return 0;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) {
    throw new Error(`Invalid ${label} "${value}": not a parseable date/time.`);
  }
  return t;
}

export function getRoot(): string {
  return process.env.PI_SESSION_SEARCH_ROOT || DEFAULT_ROOT;
}

function getPositiveEnvInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getMaxBytes(): number {
  return getPositiveEnvInt("PI_SESSION_SEARCH_MAX_BYTES", DEFAULT_MAX_BYTES);
}

export function getMaxLineBytes(): number {
  return getPositiveEnvInt(
    "PI_SESSION_SEARCH_MAX_LINE_BYTES",
    DEFAULT_MAX_LINE_BYTES,
  );
}

/**
 * Validate a user-supplied or LLM-supplied `maxResults` value.
 *
 * - `undefined` / `null` → DEFAULT_MAX_RESULTS (the documented default).
 * - Any other input that is not a finite integer in [1, MAX_RESULTS_HARD_CAP]
 *   (NaN, Infinity, 0, negative, fractional, non-number) → throws.
 *
 * Silently coercing an explicit invalid value is surprising (`0` becoming 20,
 * `-5` becoming 20). This function rejects loudly instead.
 *
 * The TypeBox schema enforces the same range at the tool-call layer, so this
 * throw path mainly serves programmatic callers and slash-command misuse.
 * The slash-command parser already validates `--max=` separately and never
 * reaches this function with garbage input.
 */
export function validateMaxResults(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_MAX_RESULTS;
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MAX_RESULTS_HARD_CAP
  ) {
    throw new Error(
      `maxResults must be an integer in [1, ${MAX_RESULTS_HARD_CAP}]; got ${String(raw)}`,
    );
  }
  return raw;
}

// Decode the directory-name-encoded cwd back to a real path.
// pi encodes `/home/foo/bar` as `--home-foo-bar--` (slashes -> dashes, wrapped
// in leading/trailing `--`). The decoding is best-effort and reversible only
// when the original path didn't contain literal dashes; we don't try to be
// clever about that.
export function decodeSessionDirName(name: string): string {
  let s = name;
  if (s.startsWith("--")) s = s.slice(2);
  if (s.endsWith("--")) s = s.slice(0, -2);
  return "/" + s.replace(/-/g, "/");
}

/**
 * Compile a user-supplied query string into a RegExp.
 *
 * - `/pattern/flags` form: slash-delimited regex syntax, not full JS literal
 *   parsing.
 *     - Embedded slashes inside the pattern have no special meaning. For
 *       example, `/a/b/c` parses as body `a/b` with flags `c`. `c` is not a
 *       valid flag, so this throws.
 *     - This form respects user flags except `g` and `y`. It strips those
 *       two flags because they break the rest of the search loop:
 *         - `g` makes `String.prototype.match()` return an array without
 *           `.index`. If the code did not strip `g`, every snippet would
 *           silently start at offset 0 instead of the real match position.
 *         - `y` (sticky) keeps internal `lastIndex` state across calls. That
 *           state causes non-deterministic matches when the code reuses the
 *           same compiled regex across haystacks.
 *     - Case sensitivity follows the flags as written: `/Foo/` is
 *       case-sensitive, `/Foo/i` is case-insensitive.
 *     - An empty regex (`//`) is rejected. The matcher requires `.+` for the
 *       pattern, and an empty pattern would match every position and be
 *       useless, so `.+` correctly rejects it.
 * - Plain string form: literal substring search. This form escapes regex
 *   metacharacters and is always case-insensitive, matching the documented
 *   historical default.
 */
export function compileQuery(q: string): RegExp {
  const m = q.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (m) {
      const safeFlags = m[2].replace(/[gy]/g, "");
      return new RegExp(m[1], safeFlags);
    }
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch (e) {
    throw new Error(`Invalid query "${q}": ${(e as Error).message}`);
  }
}

// Parse the timestamp prefix of a pi session filename.
// Format: "2026-04-23T06-48-02-781Z_<uuid>.jsonl". Returns ms since epoch or 0.
export function parseSessionFileTimestamp(filename: string): number {
  const m = filename.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/,
  );
  if (!m) return 0;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

export function extractToolCallText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; name?: string; arguments?: unknown };
    if (b.type === "toolCall" && typeof b.name === "string") {
      let args = "";
      try {
        args = JSON.stringify(b.arguments ?? {});
      } catch {
        args = "{}";
      }
      parts.push(
        `[tool: ${b.name} ${args.length > 400 ? args.slice(0, 400) + "\u2026" : args}]`,
      );
    }
  }
  return parts.join("\n");
}

export interface Hit {
  // Path to the session JSONL file *relative to the configured sessions root*
  // (e.g. "--home-foo--/2026-04-23T06-48-02-781Z_<uuid>.jsonl"). Use this with
  // read_session — it accepts either this relative path or an absolute one.
  sessionFile: string;
  sessionId: string;
  sessionCwd: string;
  timestamp: string;
  role: string; // "user" | "assistant" | "toolCall"
  snippet: string;
}

export interface SearchOptions {
  query: string;
  cwd?: string;
  since?: string;
  until?: string;
  role?: "user" | "assistant" | "any";
  includeToolCalls?: boolean;
  maxResults?: number;
  excludeSessionId?: string;
  snippetBefore?: number;
  snippetAfter?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  hits: Hit[];
  scannedFiles: number;
  skippedFiles: number;
  truncated: boolean;
}

export async function searchSessions(
  opts: SearchOptions,
): Promise<SearchResult> {
  const root = getRoot();
  const maxBytes = getMaxBytes();
  const re = compileQuery(opts.query);
  const sinceMs = parseDateOrThrow(opts.since, "since");
  const untilMs = parseDateOrThrow(opts.until, "until");
  const roleFilter = opts.role ?? "any";
  const max = validateMaxResults(opts.maxResults);
  const before = opts.snippetBefore ?? DEFAULT_SNIPPET_BEFORE;
  const after = opts.snippetAfter ?? DEFAULT_SNIPPET_AFTER;

  const hits: Hit[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;
  let truncated = false;

  // Resolve the configured root once so we can apply the same symlink-
  // containment check we already do in read_session to every subdirectory we
  // walk. This stops a symlinked entry inside the sessions root from
  // silently widening the search to arbitrary parts of the filesystem.
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(root);
  } catch {
    resolvedRoot = path.resolve(root);
  }

  let dirs: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return { hits, scannedFiles, skippedFiles, truncated };
  }

  outer: for (const d of dirs) {
    if (opts.signal?.aborted) break;
    if (!d.isDirectory()) continue;
    const sessionCwd = decodeSessionDirName(d.name);
    if (
      opts.cwd &&
      !sessionCwd.includes(opts.cwd) &&
      !d.name.includes(opts.cwd)
    )
      continue;

    const dirPath = path.join(root, d.name);

    // Symlink containment per subdirectory. A directory entry that resolves
    // outside the configured sessions root is silently skipped (counted as a
    // skipped file for visibility). We accept the d.isDirectory() check
    // already filtering most cases; this is belt-and-braces.
    let resolvedSubdir: string;
    try {
      resolvedSubdir = await realpath(dirPath);
    } catch {
      continue;
    }
    if (
      !resolvedSubdir.startsWith(resolvedRoot + path.sep) &&
      resolvedSubdir !== resolvedRoot
    ) {
      skippedFiles += 1;
      continue;
    }

    let files: string[];
    try {
      files = (await readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const f of files) {
      if (opts.signal?.aborted) break outer;
      const full = path.join(dirPath, f);

      // Symlink containment per file: a `.jsonl` symlinked to outside the
      // sessions root would otherwise be silently followed by readFile()
      // below. We resolve and check before stat-ing.
      let resolvedFile: string;
      try {
        resolvedFile = await realpath(full);
      } catch {
        continue;
      }
      if (
        !resolvedFile.startsWith(resolvedRoot + path.sep) &&
        resolvedFile !== resolvedRoot
      ) {
        skippedFiles += 1;
        continue;
      }

      let st;
      try {
        st = await stat(resolvedFile);
      } catch {
        continue;
      }
      // Use the filename timestamp (session start) for since/until, not
      // mtime. mtime reflects the last write, so it would let an old
      // conversation pass a recent `since` filter.
      const startMs = parseSessionFileTimestamp(f) || st.mtimeMs;
      if (sinceMs && startMs < sinceMs) continue;
      if (untilMs && startMs > untilMs) continue;
      if (st.size > maxBytes) {
        skippedFiles += 1;
        continue;
      }

      let raw: string;
      try {
        raw = await readFile(resolvedFile, "utf8");
      } catch {
        continue;
      }
      scannedFiles += 1;

      let sessionId = "";
      let headerCwd = sessionCwd;
      for (const line of raw.split("\n")) {
        if (!line) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }

        if (obj.type === "session") {
          sessionId = String(obj.id ?? "");
          if (obj.cwd) headerCwd = String(obj.cwd);
          if (opts.excludeSessionId && sessionId === opts.excludeSessionId) {
            // stop scanning this file entirely
            break;
          }
          continue;
        }

        if (obj.type !== "message") continue;
        const msg = obj.message;
        if (!msg) continue;
        const role = msg.role;
        if (roleFilter !== "any" && role !== roleFilter) continue;
        if (role !== "user" && role !== "assistant") continue;

        const haystacks: Array<{ kind: string; text: string }> = [];
        const text = extractText(msg.content);
        if (text) haystacks.push({ kind: role, text });
        if (opts.includeToolCalls && role === "assistant") {
          const tcText = extractToolCallText(msg.content);
          if (tcText) haystacks.push({ kind: "toolCall", text: tcText });
        }

        for (const h of haystacks) {
          // Cap haystack length before regex to bound worst-case backtracking.
          const haystack =
            h.text.length > MAX_HAYSTACK_BYTES
              ? h.text.slice(0, MAX_HAYSTACK_BYTES)
              : h.text;
          const m = haystack.match(re);
          if (!m) continue;
          const idx = m.index ?? 0;
          const snippet = haystack
            .slice(Math.max(0, idx - before), idx + after)
            .trim();
          hits.push({
            // Display path is the original (non-realpath) location so it round-trips
            // through read_session's relative-path acceptance and matches what the
            // user sees in their sessions directory.
            sessionFile: path.relative(root, full) || full,
            sessionId,
            sessionCwd: headerCwd,
            timestamp: String(obj.timestamp ?? ""),
            role: h.kind,
            snippet,
          });
          if (hits.length >= max) {
            truncated = true;
            break outer;
          }
        }
      }
    }
  }

  // Sort hits newest-first by parsed timestamp. Falls back to 0 for unparseable
  // values so they sort to the end rather than scrambling lexicographically.
  hits.sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  return { hits, scannedFiles, skippedFiles, truncated };
}

interface SessionEntry {
  ts: number;
  role: "user" | "assistant";
  content: unknown;
}

function hasReadableContent(
  role: "user" | "assistant",
  content: unknown,
): boolean {
  if (typeof content === "string") return content.length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!block || typeof block !== "object") return false;
    const value = block as { type?: string; text?: string; name?: string };
    if (value.type === "text") return Boolean(value.text);
    return (
      role === "assistant" && value.type === "toolCall" && Boolean(value.name)
    );
  });
}

function parseSessionEntry(obj: any): SessionEntry | null {
  if (obj.type !== "message") return null;
  const msg = obj.message;
  const role = msg?.role;
  if (role !== "user" && role !== "assistant") return null;
  if (!hasReadableContent(role, msg.content)) return null;
  return {
    ts: Date.parse(String(obj.timestamp ?? "")) || 0,
    role,
    content: msg.content,
  };
}

function formatSessionEntry(entry: SessionEntry): string {
  const text = extractText(entry.content);
  const tools =
    entry.role === "assistant" ? extractToolCallText(entry.content) : "";
  return [text, tools].filter(Boolean).join("\n");
}

async function forEachJsonLine(
  file: string,
  visit: (obj: any) => boolean | void,
): Promise<void> {
  const input = createReadStream(file);
  const maxLineBytes = getMaxLineBytes();
  let lineParts: Buffer[] = [];
  let lineBytes = 0;

  const visitLine = (): boolean => {
    if (lineBytes === 0) return true;
    let line = Buffer.concat(lineParts, lineBytes).toString("utf8");
    if (line.endsWith("\r")) line = line.slice(0, -1);
    lineParts = [];
    lineBytes = 0;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return true;
    }
    return visit(obj) !== false;
  };

  try {
    for await (const chunk of input) {
      const bytes = chunk as Buffer;
      let offset = 0;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(0x0a, offset);
        const end = newline === -1 ? bytes.length : newline;
        const part = bytes.subarray(offset, end);
        if (lineBytes + part.length > maxLineBytes) {
          throw new Error(
            `Refusing to read session record larger than PI_SESSION_SEARCH_MAX_LINE_BYTES (${maxLineBytes}).`,
          );
        }
        if (part.length > 0) {
          lineParts.push(part);
          lineBytes += part.length;
        }
        if (newline === -1) break;
        if (!visitLine()) return;
        offset = newline + 1;
      }
    }
    visitLine();
  } finally {
    input.destroy();
  }
}

function validateReadCount(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum: number,
): number {
  const parsed = value ?? fallback;
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > MAX_READ_MESSAGES_HARD_CAP
  ) {
    throw new Error(
      `${label} must be an integer in [${minimum}, ${MAX_READ_MESSAGES_HARD_CAP}]; got ${String(parsed)}`,
    );
  }
  return parsed;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length <= maxBytes) return value;
  return encoded
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
}

export async function readSessionWindow(opts: {
  sessionFile: string;
  aroundTimestamp?: string;
  contextMessages?: number;
  maxMessages?: number;
}): Promise<string> {
  const root = getRoot();
  const candidate = path.isAbsolute(opts.sessionFile)
    ? opts.sessionFile
    : path.join(root, opts.sessionFile);
  let resolvedRoot: string;
  let resolvedFile: string;
  try {
    resolvedRoot = await realpath(root);
  } catch {
    resolvedRoot = path.resolve(root);
  }
  try {
    resolvedFile = await realpath(candidate);
  } catch {
    resolvedFile = path.resolve(candidate);
  }
  if (
    !resolvedFile.startsWith(resolvedRoot + path.sep) &&
    resolvedFile !== resolvedRoot
  ) {
    throw new Error(`Refusing to read outside session root: ${resolvedRoot}`);
  }

  try {
    await stat(resolvedFile);
  } catch (e) {
    throw new Error(`Could not stat session file: ${(e as Error).message}`);
  }

  const contextMessages = validateReadCount(
    opts.contextMessages,
    6,
    "contextMessages",
    0,
  );
  const maxMessages = validateReadCount(opts.maxMessages, 30, "maxMessages", 1);
  const target = opts.aroundTimestamp
    ? parseDateOrThrow(opts.aroundTimestamp, "aroundTimestamp")
    : null;

  let header: any = null;
  let entryCount = 0;
  let nearestIndex = 0;
  let nearestDifference = Infinity;

  // The first pass scans the complete source to find exact message indexes
  // without retaining transcript text. The second pass below streams from the
  // beginning through the selected window. Memory is independent of source
  // size, but each call performs work proportional to the source file size.
  await forEachJsonLine(resolvedFile, (obj) => {
    if (obj.type === "session") {
      header = obj;
      return;
    }
    const entry = parseSessionEntry(obj);
    if (!entry) return;
    if (target !== null) {
      const difference = Math.abs(entry.ts - target);
      if (difference < nearestDifference) {
        nearestDifference = difference;
        nearestIndex = entryCount;
      }
    }
    entryCount += 1;
  });

  let startIdx =
    target === null ? 0 : Math.max(0, nearestIndex - contextMessages);
  let endIdx =
    target === null
      ? entryCount
      : Math.min(entryCount, nearestIndex + contextMessages + 1);
  if (endIdx - startIdx > maxMessages) endIdx = startIdx + maxMessages;

  const maxOutputBytes = getMaxBytes();
  const out: string[] = [];
  let outputBytes = 0;
  let outputTruncated = false;
  const appendOutput = (value: string): boolean => {
    const valueBytes = Buffer.byteLength(value, "utf8");
    const remaining = maxOutputBytes - outputBytes;
    if (valueBytes <= remaining) {
      out.push(value);
      outputBytes += valueBytes;
      return true;
    }
    out.push(truncateUtf8(value, remaining));
    outputBytes = maxOutputBytes;
    outputTruncated = true;
    return false;
  };

  const sessionHeading = header
    ? `# Session ${header.id} — cwd: ${header.cwd} — started: ${header.timestamp}\n`
    : "";
  const shownStart = entryCount === 0 ? 0 : startIdx + 1;
  appendOutput(
    `${sessionHeading}# Showing messages ${shownStart}–${endIdx} of ${entryCount}\n\n`,
  );

  let currentIndex = 0;
  if (!outputTruncated) {
    await forEachJsonLine(resolvedFile, (obj) => {
      const entry = parseSessionEntry(obj);
      if (!entry) return;
      const index = currentIndex;
      currentIndex += 1;
      if (index < startIdx) return;
      if (index >= endIdx) return false;
      const block = `## ${entry.role} @ ${new Date(entry.ts).toISOString()}\n${formatSessionEntry(entry)}\n\n`;
      if (!appendOutput(block)) return false;
    });
  }

  const output = out.join("");
  if (!outputTruncated) return output;
  const notice = truncateUtf8(READ_TRUNCATION_NOTICE, maxOutputBytes);
  const body = truncateUtf8(
    output,
    Math.max(0, maxOutputBytes - Buffer.byteLength(notice, "utf8")),
  );
  return body + notice;
}

export function formatHitsForCommand(result: SearchResult): string {
  if (result.hits.length === 0) {
    return `No matches. (scanned ${result.scannedFiles} files, skipped ${result.skippedFiles})`;
  }
  const lines: string[] = [];
  lines.push(
    `${result.hits.length} hit${result.hits.length === 1 ? "" : "s"}${result.truncated ? " (truncated)" : ""}, scanned ${result.scannedFiles} files:`,
  );
  for (const h of result.hits) {
    lines.push("");
    lines.push(`• ${h.timestamp}  [${h.role}]  ${h.sessionCwd}`);
    lines.push(`  ${h.sessionFile}`);
    const snippet = h.snippet.replace(/\s+/g, " ").slice(0, 280);
    lines.push(`  ${snippet}`);
  }
  return lines.join("\n");
}

/**
 * Parse `/find-sessions` arguments. Pure helper extracted so it can be unit-
 * tested without having to mock an ExtensionCommandContext. Returns either
 * a validated `query` (plus optional flags) or an `error` message.
 */
export interface ParsedFindArgs {
  query?: string;
  cwd?: string;
  role?: "user" | "assistant" | "any";
  since?: string;
  until?: string;
  max?: number;
  error?: string;
}

export function parseFindSessionsArgs(raw: string): ParsedFindArgs {
  const out: ParsedFindArgs = {};
  const rest: string[] = [];
  for (const tok of raw.trim().split(/\s+/)) {
    if (tok.startsWith("--cwd=")) out.cwd = tok.slice("--cwd=".length);
    else if (tok.startsWith("--role=")) {
      const v = tok.slice("--role=".length);
      if (v === "user" || v === "assistant" || v === "any") out.role = v;
      else return { error: `Invalid --role=${v}. Use user|assistant|any.` };
    } else if (tok.startsWith("--since="))
      out.since = tok.slice("--since=".length);
    else if (tok.startsWith("--until="))
      out.until = tok.slice("--until=".length);
    else if (tok.startsWith("--max=")) {
      const n = Number.parseInt(tok.slice("--max=".length), 10);
      if (Number.isFinite(n) && n > 0) out.max = n;
      else
        return {
          error: `Invalid --max=${tok.slice("--max=".length)}. Use a positive integer.`,
        };
    } else rest.push(tok);
  }
  const query = rest.join(" ").trim();
  if (query) out.query = query;
  return out;
}

function getCurrentSessionId(ctx: ExtensionContext): string | undefined {
  try {
    const header = (
      ctx.sessionManager as { getHeader?: () => { id?: string } | null }
    ).getHeader?.();
    return header?.id;
  } catch {
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search_sessions",
    label: "Search prior pi sessions",
    description: `Search past pi session transcripts (~/${CONFIG_DIR_NAME}/agent/sessions) for a topic. Use when the user asks 'have we discussed X before?', 'what did we decide about Y?', or wants to find a prior session without resuming it. Read-only.`,
    promptSnippet: "Find prior pi sessions matching a query.",
    promptGuidelines: [
      "Use search_sessions when the user references prior conversations or asks if a topic was discussed before.",
      "Pass a focused `query` (substring or `/regex/flags`). Narrow with `cwd` if you know which project.",
      "After a promising hit, call read_session with the returned `sessionFile` (and optionally `aroundTimestamp`) to pull more context.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Plain substring (case-insensitive) or `/regex/flags` form. Regex flags `g` and `y` are stripped because they break the snippet/index logic; case-sensitivity in the regex form is honored (use `/Foo/i` for case-insensitive). Searches user/assistant message text.",
      }),
      cwd: Type.Optional(
        Type.String({
          description:
            "Filter sessions by working directory (substring match against the session's cwd, e.g. 'OneAdobe' or '/home/sesselma/workspace').",
        }),
      ),
      since: Type.Optional(
        Type.String({
          description:
            "ISO date/time; ignore sessions started before this (parsed from filename timestamp).",
        }),
      ),
      until: Type.Optional(
        Type.String({
          description:
            "ISO date/time; ignore sessions started after this (parsed from filename timestamp).",
        }),
      ),
      role: Type.Optional(
        Type.Union(
          [
            Type.Literal("user"),
            Type.Literal("assistant"),
            Type.Literal("any"),
          ],
          {
            description:
              "Restrict matches to user messages, assistant messages, or both. Default: any.",
          },
        ),
      ),
      includeToolCalls: Type.Optional(
        Type.Boolean({
          description:
            "Also search assistant tool-call names/arguments. Default false.",
        }),
      ),
      maxResults: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_RESULTS_HARD_CAP,
          description: `Maximum number of hits to return. Default ${DEFAULT_MAX_RESULTS}, hard cap ${MAX_RESULTS_HARD_CAP}.`,
        }),
      ),
      includeCurrentSession: Type.Optional(
        Type.Boolean({
          description: "Include the current session in results. Default false.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const query = String(params.query ?? "").trim();
      if (!query) {
        return {
          content: [{ type: "text", text: "Error: `query` is required." }],
          details: {},
          isError: true,
        };
      }
      const excludeSessionId = params.includeCurrentSession
        ? undefined
        : getCurrentSessionId(ctx);
      try {
        const result = await searchSessions({
          query,
          cwd: params.cwd as string | undefined,
          since: params.since as string | undefined,
          until: params.until as string | undefined,
          role: params.role as "user" | "assistant" | "any" | undefined,
          includeToolCalls: params.includeToolCalls as boolean | undefined,
          maxResults: params.maxResults as number | undefined,
          excludeSessionId,
          signal,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: result.hits.length,
                  truncated: result.truncated,
                  scannedFiles: result.scannedFiles,
                  skippedFiles: result.skippedFiles,
                  hits: result.hits,
                },
                null,
                2,
              ),
            },
          ],
          details: { count: result.hits.length, truncated: result.truncated },
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `search_sessions failed: ${(e as Error).message}`,
            },
          ],
          details: {},
          isError: true,
        };
      }
    },
    renderResult: renderExpandableSessionResult,
  });

  pi.registerTool({
    name: "read_session",
    label: "Read a window of a prior pi session",
    description:
      "Read a slice of a prior pi session transcript. Use after search_sessions returns a promising hit to pull surrounding context. Read-only.",
    promptSnippet: "Read a window from a prior pi session JSONL file.",
    promptGuidelines: [
      "Pass `sessionFile` exactly as returned by search_sessions.",
      "If you have a hit's `timestamp`, pass it as `aroundTimestamp` to center the window on it.",
      "Keep `maxMessages` modest — these transcripts can be huge.",
    ],
    parameters: Type.Object({
      sessionFile: Type.String({
        description:
          "Path to a session .jsonl file. Either absolute, or relative to the configured sessions root (as returned by search_sessions).",
      }),
      aroundTimestamp: Type.Optional(
        Type.String({
          description:
            "ISO timestamp to center the window on (e.g. a hit's timestamp).",
        }),
      ),
      contextMessages: Type.Optional(
        Type.Number({
          description:
            "Messages of context on each side of the target. Default 6.",
        }),
      ),
      maxMessages: Type.Optional(
        Type.Number({
          description: "Hard cap on returned messages. Default 30.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      try {
        const text = await readSessionWindow({
          sessionFile: String(params.sessionFile),
          aroundTimestamp: params.aroundTimestamp as string | undefined,
          contextMessages: params.contextMessages as number | undefined,
          maxMessages: params.maxMessages as number | undefined,
        });
        return { content: [{ type: "text", text }], details: {} };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `read_session failed: ${(e as Error).message}`,
            },
          ],
          details: {},
          isError: true,
        };
      }
    },
    renderResult: renderExpandableSessionResult,
  });

  pi.registerCommand("find-sessions", {
    description:
      "Search past pi sessions for a query string. Usage: /find-sessions [--cwd=substr] [--role=user|assistant] [--since=ISO] [--until=ISO] [--max=N] <query>",
    handler: async (rawArgs, ctx) => {
      const args = (rawArgs ?? "").trim();
      if (!args) {
        ctx.ui.notify(
          "Usage: /find-sessions [--cwd=…] [--role=…] [--since=…] [--until=…] [--max=N] <query>",
          "warning",
        );
        return;
      }
      const parsed = parseFindSessionsArgs(args);
      if (parsed.error) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }
      if (!parsed.query) {
        ctx.ui.notify("Missing query.", "warning");
        return;
      }
      ctx.ui.notify(`Searching prior sessions for: ${parsed.query}`, "info");
      const result = await searchSessions({
        query: parsed.query,
        cwd: parsed.cwd,
        role: parsed.role,
        since: parsed.since,
        until: parsed.until,
        maxResults: parsed.max,
        excludeSessionId: getCurrentSessionId(ctx),
      });
      pi.sendMessage(
        {
          customType: "session-search",
          content: formatHitsForCommand(result),
          display: true,
        },
        { triggerTurn: false },
      );
    },
  });
}
