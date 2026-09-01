/**
 * session — commands for managing the current session's file on disk:
 *
 * - continue.ts: /continue copies a relaunch command to the clipboard.
 * - delete.ts: /delete removes the session and its subagent transcripts.
 * - move.ts: /move relocates the session to another working directory.
 * - side.ts: /side launches a right-hand Ghostty fork.
 * - summary.ts: names sessions with an LLM summary from a separate model.
 *
 * /delete marks the session "skip-summary" on shutdown, but only if the
 * delete actually proceeds. summary.ts honors that marker, so deleted
 * sessions are not named.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import continueCommand from "./continue.ts";
import deleteCommand from "./delete.ts";
import moveCommand from "./move.ts";
import sideCommand from "./side.ts";
import summary from "./summary.ts";

export default function (pi: ExtensionAPI) {
  continueCommand(pi);
  deleteCommand(pi);
  moveCommand(pi);
  sideCommand(pi);
  summary(pi);
}
