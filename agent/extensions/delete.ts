/**
 * Delete Session Extension
 *
 * Adds a /delete command to delete the current session.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { unlink } from "node:fs/promises";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("delete", {
    description: "Delete the current session",
    handler: async (_args, ctx) => {
      const oldSessionFile = ctx.sessionManager.getSessionFile();

      pi.appendEntry("skip-summary", {});

      await ctx.newSession({
        withSession: async (newCtx) => {
          if (oldSessionFile) {
            try {
              await unlink(oldSessionFile);
              newCtx.ui.notify("Session deleted.", "info");
            } catch (err: any) {
              if (err?.code !== "ENOENT") {
                newCtx.ui.notify(`Failed to delete session: ${err}`, "error");
                return;
              }
            }
          } else {
            newCtx.ui.notify(
              "No session file to delete (ephemeral session).",
              "info",
            );
          }
        },
      });
    },
  });
}
