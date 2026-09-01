/**
 * termination.ts — Explain why a child's answer is missing or incomplete.
 *
 * Provider error text is never echoed, only matched against. That text can
 * embed keys, request ids, and the child's own prompt. The parent sends its
 * own context to a model and persists it, so an echoed error could carry
 * those secrets forward.
 *
 * A character allowlist was tried and rejected: a leaked prompt is ordinary
 * prose, so no syntactic filter can separate it from a benign message.
 *
 * The parent gets a class and a pointer to the transcript instead. The
 * transcript keeps the full text for a human to read.
 */

import type { AgentRecord } from "./types.ts";

/** Grouped by what the parent would do about it, not by status code. */
export type ErrorClass = keyof typeof ERROR_CLASSES;

const ERROR_CLASSES = {
  transient: { label: "transient provider failure", permanent: false },
  credentials: {
    label: "authentication or permission failure",
    permanent: true,
  },
  request: { label: "model or request rejected", permanent: true },
  unknown: { label: "unrecognized provider error", permanent: false },
} as const;

// Checked in order. Transient wins ties, because a 403 body can say "rate
// limit exceeded" and wrongly calling that permanent suppresses a retry that
// would have worked. Status codes are word-bounded so an id like
// `req_01H404ABC` or a duration like `1401ms` is not read as one.
const PATTERNS: ReadonlyArray<readonly [ErrorClass, RegExp]> = [
  [
    "transient",
    /\b429\b|\b5\d{2}\b|rate.?limit|quota|unavailable|overloaded|internal server error|connection|network|socket|timeout|econnreset|etimedout|abort/i,
  ],
  [
    "credentials",
    /\b401\b|\b403\b|unauthoriz|forbidden|invalid[_ ]?api[_ ]?key|incorrect api key|api key not valid|authentication token has been invalidated|token (has )?expired|permission denied|do not have access/i,
  ],
  [
    "request",
    /\b400\b|\b404\b|does not exist|model not found|context length|maximum context|too many tokens/i,
  ],
];

export function classifyProviderError(raw: string | undefined): ErrorClass {
  if (!raw?.trim()) return "unknown";
  return PATTERNS.find(([, re]) => re.test(raw))?.[0] ?? "unknown";
}

/**
 * The short human label for a failure, without the advice or the transcript
 * pointer `terminationNote` adds. Carries no provider text, for the same reason
 * documented above: it is only ever matched against, never echoed.
 */
export function providerErrorLabel(raw: string | undefined): string {
  return ERROR_CLASSES[classifyProviderError(raw)].label;
}

/**
 * Why the child's answer is missing or incomplete, or undefined if it is
 * neither. Never contains provider text.
 */
export function terminationNote(record: AgentRecord): string | undefined {
  const turns = `after ${record.turns} ${record.turns === 1 ? "turn" : "turns"}`;
  const where = record.transcriptFile
    ? `\nFull provider text is in the child transcript: ${record.transcriptFile}`
    : "";

  switch (record.stopReason) {
    case "error":
      return providerNote(record.errorMessage, turns, where);
    case "aborted": {
      const cause = record.userAborted
        ? " (stopped by the user)"
        : record.hitTurnLimit
          ? " (turn budget exhausted)"
          : "";
      return `The child was cancelled ${turns}${cause}.`;
    }
    case "length":
      return `The child hit the model's output limit ${turns}, so its answer is cut off.`;
    default:
      // A thrown error is provider text too, so it crosses the same boundary.
      return record.error?.trim()
        ? providerNote(record.error, turns, where)
        : undefined;
  }
}

function providerNote(raw: string | undefined, turns: string, where: string) {
  const { label, permanent } = ERROR_CLASSES[classifyProviderError(raw)];
  const advice = permanent
    ? "\nRelaunching as-is will fail the same way. Fix the credential or model, or dispatch to a different provider."
    : "";
  return `The child failed ${turns}: ${label}.${advice}${where}`;
}

/**
 * The child's answer, or why there isn't a complete one. Shared by every path
 * that reports a result.
 *
 * The run sets `record.error` only when it throws. A provider failure
 * resolves normally with empty text instead, so the reason must come from
 * the last assistant message.
 *
 * Text from before a failure stays available, but never alone: streamed
 * output carries over across messages, so an aborted child could otherwise
 * return an earlier message and look like it succeeded.
 */
export function resultOrReason(record: AgentRecord): string {
  const answer = record.result?.trim();
  const note = terminationNote(record);
  if (!note) return answer || "No final response, and no reason was reported.";
  return answer ? `${note}\n\nPartial output:\n${answer}` : note;
}
