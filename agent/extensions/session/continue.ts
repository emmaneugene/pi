import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, resumeCommand } from "../../lib/session-resume.ts";

/**
 * /continue
 *
 * Copies the command to resume the current pi session to the clipboard, in the
 * same form /move uses:  cd <cwd> && pi --session <id>
 *
 * Unlike /move it changes nothing: no files move, no shutdown. It just hands
 * you a one-paste relaunch for another terminal (e.g. a fresh Ghostty split).
 */

export default function (pi: ExtensionAPI) {
  pi.registerCommand("continue", {
    description: "Copy the command to resume this session to the clipboard",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/continue requires an interactive session", "error");
        return;
      }

      const sm = ctx.sessionManager;
      if (!sm.getSessionFile()) {
        ctx.ui.notify("This session is ephemeral (nothing to resume)", "error");
        return;
      }

      const resumeCmd = resumeCommand(sm.getCwd(), sm.getSessionId());
      const copied = copyToClipboard(resumeCmd);

      ctx.ui.notify(
        copied
          ? `Resume command copied to clipboard: ${resumeCmd}`
          : `Could not reach the clipboard. Resume with: ${resumeCmd}`,
        copied ? "info" : "error",
      );
    },
  });
}
