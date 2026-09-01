/**
 * Pure matching logic for the `edit` override.
 *
 * Kept free of pi imports so it can be tested directly. All functions operate on
 * LF-normalized, BOM-stripped content. Nothing here touches the filesystem: the
 * built-in edit tool performs every write.
 */

export interface EditSpec {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

interface Replacement {
  editIndex: number;
  index: number;
  length: number;
  newText: string;
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

/** Non-overlapping occurrence offsets of `needle` in `haystack`. */
export function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const indices: number[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return indices;
    indices.push(index);
    from = index + needle.length;
  }
}

/** 1-based line number of a character offset. */
export function lineOfOffset(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * Mirror of the built-in matcher's `normalizeForFuzzyMatch`, used only to
 * locate occurrences for an error message. If this mirror drifts from
 * upstream, only the error message degrades, not an edit: the caller
 * discards this function's result unless its count agrees with the count
 * the built-in itself reported.
 *
 * This function preserves line count, so the line numbers it computes stay
 * valid in the original content.
 */
function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

/**
 * Line numbers of every occurrence of `oldText`: an exact scan when that finds
 * duplicates, otherwise the whitespace-insensitive scan the built-in uses.
 */
export function locateOccurrences(content: string, oldText: string): number[] {
  const needle = normalizeToLF(oldText);
  const exact = findAllOccurrences(content, needle);
  if (exact.length > 1)
    return exact.map((index) => lineOfOffset(content, index));

  const fuzzyContent = normalizeForFuzzyMatch(content);
  return findAllOccurrences(fuzzyContent, normalizeForFuzzyMatch(needle)).map(
    (index) => lineOfOffset(fuzzyContent, index),
  );
}

const MAX_REPORTED_LINES = 10;

function editLabel(editIndex: number, totalEdits: number): string {
  return totalEdits === 1 ? "the text" : `edits[${editIndex}]`;
}

/**
 * The duplicate-match error the built-in cannot produce: it names where the
 * occurrences are, and states the bulk alternative outright. The location is
 * omitted when it could not be established, but the alternative never is.
 */
export function duplicateMatchError(
  path: string,
  editIndex: number,
  totalEdits: number,
  count: number,
  lines: number[],
): Error {
  const shown = lines.slice(0, MAX_REPORTED_LINES).join(", ");
  const overflow =
    lines.length > MAX_REPORTED_LINES
      ? `, +${lines.length - MAX_REPORTED_LINES} more`
      : "";
  const where = lines.length === count ? ` at lines ${shown}${overflow}` : "";
  return new Error(
    `Found ${count} occurrences of ${editLabel(editIndex, totalEdits)} in ${path}${where}. ` +
      `Add surrounding context to target a single occurrence, or set edits[${editIndex}].replaceAll: true to rewrite all ${count}.`,
  );
}

/**
 * Recognize the built-in tool's bare duplicate-count error and extract which
 * edit it refers to. Returns undefined for every other error.
 */
export function parseDuplicateError(
  message: string,
): { count: number; editIndex: number } | undefined {
  const match =
    /^Found (\d+) occurrences of (?:the text|edits\[(\d+)\]) in /.exec(message);
  if (!match) return undefined;
  return {
    count: Number(match[1]),
    editIndex: match[2] === undefined ? 0 : Number(match[2]),
  };
}

function notFoundError(
  path: string,
  editIndex: number,
  totalEdits: number,
): Error {
  return new Error(
    `Could not find ${editLabel(editIndex, totalEdits)} in ${path}. ` +
      `The oldText must match exactly, including all whitespace and newlines. ` +
      `Whitespace-insensitive matching is not applied when any edit sets replaceAll.`,
  );
}

/**
 * Resolve every edit against `content` and return the replacements to apply,
 * sorted by offset. Throws on empty, missing, ambiguous, or overlapping edits.
 */
export function planReplacements(
  content: string,
  edits: EditSpec[],
  path: string,
): Replacement[] {
  const plans: Replacement[] = [];

  for (let i = 0; i < edits.length; i++) {
    const oldText = normalizeToLF(edits[i].oldText);
    const newText = normalizeToLF(edits[i].newText);

    if (oldText.length === 0) {
      throw new Error(
        edits.length === 1
          ? `oldText must not be empty in ${path}.`
          : `edits[${i}].oldText must not be empty in ${path}.`,
      );
    }

    const indices = findAllOccurrences(content, oldText);
    if (indices.length === 0) throw notFoundError(path, i, edits.length);
    if (indices.length > 1 && !edits[i].replaceAll) {
      throw duplicateMatchError(
        path,
        i,
        edits.length,
        indices.length,
        indices.map((index) => lineOfOffset(content, index)),
      );
    }

    const targets = edits[i].replaceAll ? indices : [indices[0]];
    for (const index of targets) {
      plans.push({ editIndex: i, index, length: oldText.length, newText });
    }
  }

  plans.sort((a, b) => a.index - b.index);
  for (let i = 1; i < plans.length; i++) {
    const previous = plans[i - 1];
    const current = plans[i];
    if (previous.index + previous.length > current.index) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. ` +
          `Merge them into one edit or target disjoint regions.`,
      );
    }
  }

  return plans;
}

/** Plan and apply every edit against LF-normalized `content`. */
export function applyEdits(
  content: string,
  edits: EditSpec[],
  path: string,
): { newContent: string; replacements: number } {
  const plans = planReplacements(content, edits, path);

  // Applied in reverse so earlier offsets stay valid.
  let newContent = content;
  for (let i = plans.length - 1; i >= 0; i--) {
    const plan = plans[i];
    newContent =
      newContent.slice(0, plan.index) +
      plan.newText +
      newContent.slice(plan.index + plan.length);
  }

  if (newContent === content) {
    throw new Error(
      edits.length === 1
        ? `No changes made to ${path}. The replacement produced identical content.`
        : `No changes made to ${path}. The replacements produced identical content.`,
    );
  }
  return { newContent, replacements: plans.length };
}
