/** Persisted session policy for desktop notifications. */

export const SUPPRESS_AGENT_END_NOTIFICATION_ENTRY =
  "suppress-agent-end-notification";

/** Sessions notify by default. The immutable marker disables notification. */
export function shouldNotifyOnAgentEnd(entries: readonly unknown[]): boolean {
  return !entries.some(
    (entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      (entry as { type?: unknown }).type === "custom" &&
      (entry as { customType?: unknown }).customType ===
        SUPPRESS_AGENT_END_NOTIFICATION_ENTRY,
  );
}
