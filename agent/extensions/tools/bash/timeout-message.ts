/**
 * Rewrites the built-in bash timeout notice into something the agent can act on.
 *
 * The built-in throws an Error whose message is the partial output followed by
 * `Command timed out after N seconds`. The output is already preserved; only the
 * notice is uninformative, and it reads as a tool malfunction rather than as a
 * command that needs rethinking.
 */

const TIMEOUT_NOTICE = /Command timed out after (\d+) seconds\.?\s*$/;

/** A longer explicit timeout to suggest, rounded to something a model will reuse. */
const SUGGESTED_EXPLICIT_TIMEOUT = 1800;

/**
 * Replace the trailing notice with guidance, preserving the partial output.
 * Returns the message unchanged if it is not a timeout.
 *
 * `explicit` distinguishes a timeout the model chose from the extension
 * default. If the model already asked for a longer window, telling it to
 * pass one is noise.
 */
export function rewriteTimeoutMessage(
  message: string,
  explicit: boolean,
): string {
  const match = TIMEOUT_NOTICE.exec(message);
  if (!match) return message;

  const seconds = Number(match[1]);
  const partial = message.slice(0, match.index).replace(/\s+$/, "");

  // Ordered by how often each actually applies. Across ~20k local bash
  // calls, most default-timeout kills were unbounded searches, not slow
  // builds.
  const options = [
    "Search or scan (find, grep, ls -R). The usual cause. Scope it: search a directory rather than /, add --include=<glob> or a path to grep -r, or use the grep and find tools, which are already scoped and truncated.",
    explicit
      ? `Genuinely long work. It already had ${seconds}s and needed more, so raising the timeout again is a guess. Prefer backgrounding it.`
      : `Genuinely long build, test suite, or CI wait. Pass an explicit timeout, which is honored well beyond the default: {"timeout": ${SUGGESTED_EXPLICIT_TIMEOUT}}.`,
    "Long, and you have other work to do. Do not block on it: run `nohup <command> > /tmp/<name>.log 2>&1 &`, then poll the log with tail, or drive it under agent-tmux.",
  ];

  const guidance = [
    `Command timed out after ${seconds}s and was killed. ${
      partial ? "The output above is partial." : "It produced no output."
    }`,
    "",
    "Re-running it unchanged will time out again. Pick the case that fits:",
    ...options.map((option) => `- ${option}`),
  ].join("\n");

  return partial ? `${partial}\n\n${guidance}` : guidance;
}

/** Rewrite a thrown bash timeout, leaving every other error untouched. */
export function explainTimeout(error: unknown, explicit: boolean): unknown {
  if (!(error instanceof Error)) return error;
  const rewritten = rewriteTimeoutMessage(error.message, explicit);
  return rewritten === error.message ? error : new Error(rewritten);
}
