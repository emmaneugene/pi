/** Delete the current session and its subagent transcripts together. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync } from "node:fs";
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  // Set only while a /delete is actively replacing the session. This guards
  // the session_shutdown handler below, so a cancelled delete never marks
  // the surviving (undeleted) session as skip-summary.
  let pendingDelete = false;

  pi.on("session_shutdown", async () => {
    if (pendingDelete) pi.appendEntry("skip-summary", {});
  });

  pi.registerCommand("delete", {
    description: "Delete the current session and any subagent transcripts",
    handler: async (_args, ctx) => {
      const oldSessionFile = ctx.sessionManager.getSessionFile();

      // Capture this session's subagent folder BEFORE newSession() swaps the
      // context out from under us. Children live in a per-parent folder, so
      // deleting them is a single recursive remove.
      let subagentDir: string | undefined;
      let subagentCount = 0;
      try {
        const dir = ctx.sessionManager.getSessionDir();
        const id = ctx.sessionManager.getSessionId();
        if (dir && id) {
          subagentDir = join(dir, "subagents", id);
          subagentCount = readdirSync(subagentDir).filter((f) =>
            f.endsWith(".jsonl"),
          ).length;
        }
      } catch {}

      pendingDelete = true;
      try {
        await ctx.newSession({
          withSession: async (newCtx) => {
            if (!oldSessionFile) {
              newCtx.ui.notify(
                "No session file to delete (ephemeral session).",
                "info",
              );
              return;
            }
            try {
              await unlink(oldSessionFile);
            } catch (err: any) {
              if (err?.code !== "ENOENT") {
                newCtx.ui.notify(`Failed to delete session: ${err}`, "error");
                return;
              }
            }
            let removed = 0;
            if (subagentDir) {
              try {
                await rm(subagentDir, { recursive: true, force: true });
                removed = subagentCount;
              } catch {}
            }
            newCtx.ui.notify(
              removed > 0
                ? `Session deleted (+${removed} subagent transcript${removed === 1 ? "" : "s"}).`
                : "Session deleted.",
              "info",
            );
          },
        });
      } finally {
        pendingDelete = false;
      }
    },
  });
}
