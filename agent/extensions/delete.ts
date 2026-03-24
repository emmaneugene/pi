/**
 * Delete Session Extension
 *
 * Adds a /delete command that deletes the current session file and quits.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { unlink } from "node:fs/promises";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("delete", {
    description: "Delete the current session and quit",
    handler: async (_args, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile) {
        try {
          await unlink(sessionFile);
        } catch (err: any) {
          if (err?.code !== "ENOENT") {
            ctx.ui.notify(`Failed to delete session: ${err}`, "error");
            return;
          }
        }
      }
      ctx.shutdown();
    },
  });
}
