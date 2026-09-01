/**
 * steer-guard.ts — When it is safe to steer a child session.
 *
 * Steering does more than annotate a session: it queues a message and
 * restarts a session that has already settled.
 *
 * That restart has a cost. A child that finished, was cancelled, or failed
 * wakes up and spends another model call. That call can overwrite a
 * complete final answer with a filler acknowledgement. Steering an aborted
 * child defeats the cancellation outright.
 *
 * One case avoids that cost: a turn that ended in a tool call was going to
 * run again regardless. Only then can a steer reuse that run instead of
 * starting a new one.
 */

/** Why the model ended its turn. Mirrors pi-ai's StopReason. */
export type TurnOutcome = "stop" | "length" | "toolUse" | "error" | "aborted";

export function willContinue(outcome: TurnOutcome | undefined): boolean {
  return outcome === "toolUse";
}
