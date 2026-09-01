import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { shellQuote } from "../../lib/session-resume.ts";

const GHOSTTY_SPLIT_SCRIPT = `on run argv
  set targetCwd to item 1 of argv
  set startupInput to item 2 of argv

  tell application "Ghostty"
    set cfg to new surface configuration
    set initial working directory of cfg to targetCwd
    set initial input of cfg to startupInput

    if (count of windows) > 0 then
      try
        set frontWindow to front window
        set targetTerminal to focused terminal of selected tab of frontWindow
        split targetTerminal direction right with configuration cfg
      on error
        new window with configuration cfg
      end try
    else
      new window with configuration cfg
    end if
    activate
  end tell
end run`;

/**
 * Reason /side can't run here, or undefined if Ghostty is usable. Probes
 * `open -Ra Ghostty` so a missing app fails with a clear message instead of
 * an opaque osascript error from `tell application "Ghostty"`.
 */
async function unavailableGhosttyReason(
  pi: ExtensionAPI,
): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    return "/side currently requires macOS and Ghostty AppleScript.";
  }
  try {
    const result = await pi.exec("open", ["-Ra", "Ghostty"], {
      timeout: 5000,
    });
    if (result.code !== 0) {
      return "Ghostty is not installed or cannot be opened.";
    }
  } catch {
    return "Ghostty is not installed or cannot be opened.";
  }
  return undefined;
}

function getPiInvocationParts(): string[] {
  const currentScript = process.argv[1];
  if (currentScript && existsSync(currentScript)) {
    return [process.execPath, currentScript];
  }

  const runtimeName = path.basename(process.execPath).toLowerCase();
  if (!/^(?:node|bun)(?:\.exe)?$/.test(runtimeName)) {
    return [process.execPath];
  }

  return ["pi"];
}

export function buildPiStartupInput(
  sessionFile: string,
  prompt: string,
): string {
  // Pi has no `--` argument separator. Prefix option-like prompts with a
  // space so the parser treats them as messages.
  const promptArg =
    prompt.length === 0 ? [] : [/^[\-@]/.test(prompt) ? ` ${prompt}` : prompt];

  const commandParts = [
    ...getPiInvocationParts(),
    "--session",
    sessionFile,
    ...promptArg,
  ];
  return `${commandParts.map(shellQuote).join(" ")}\n`;
}

/**
 * Snapshot the path from root to `leafId` into a new session file, without
 * touching the live session manager. Opens a throwaway SessionManager on the
 * source file so Pi's own branching logic (header, ids, version) builds the
 * copy; createBranchedSession() moves that instance's leaf, not the live one.
 */
export function createForkedSession(
  sourceFile: string,
  leafId: string,
): string | undefined {
  return SessionManager.open(sourceFile).createBranchedSession(leafId);
}

export default function (pi: ExtensionAPI): void {
  // Tracks the leaf that was current right before the active agent run
  // started, so a mid-turn /side forks exactly the last completed response
  // instead of whatever happens to be committed at that instant.
  let activeRunBaseLeafId: string | null | undefined;

  pi.on("before_agent_start", (_event, ctx) => {
    activeRunBaseLeafId = ctx.sessionManager.getLeafId();
  });
  pi.on("agent_settled", () => {
    activeRunBaseLeafId = undefined;
  });

  const handler = async (
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    const unavailableReason = await unavailableGhosttyReason(pi);
    if (unavailableReason) {
      ctx.ui.notify(unavailableReason, "warning");
      return;
    }

    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify("/side requires an interactive Pi session.", "error");
      return;
    }

    const wasBusy = !ctx.isIdle();
    const prompt = args.trim();

    const sourceFile = ctx.sessionManager.getSessionFile();
    const checkpointLeafId =
      wasBusy && activeRunBaseLeafId !== undefined
        ? activeRunBaseLeafId
        : ctx.sessionManager.getLeafId();

    if (!sourceFile || !checkpointLeafId) {
      ctx.ui.notify(
        "Cannot fork because this session has no completed response yet.",
        "error",
      );
      return;
    }

    let forkedSessionFile: string | undefined;
    try {
      forkedSessionFile = createForkedSession(sourceFile, checkpointLeafId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not create the forked session: ${message}`, "error");
      return;
    }

    if (!forkedSessionFile) {
      ctx.ui.notify(
        "Cannot fork because this session has no saved conversation yet.",
        "error",
      );
      return;
    }

    const startupInput = buildPiStartupInput(forkedSessionFile, prompt);
    const result = await pi.exec(
      "osascript",
      ["-e", GHOSTTY_SPLIT_SCRIPT, "--", ctx.cwd, startupInput],
      { cwd: ctx.cwd },
    );

    if (result.code !== 0) {
      const reason =
        result.stderr.trim() ||
        result.stdout.trim() ||
        "unknown osascript error";
      ctx.ui.notify(`Failed to launch the Ghostty split: ${reason}`, "error");
      ctx.ui.notify(
        `The forked session was kept at ${forkedSessionFile}.`,
        "warning",
      );
      return;
    }

    const suffix = prompt.length > 0 ? " and sent the prompt" : "";
    ctx.ui.notify(
      `Forked the session into a right Ghostty split${suffix}.`,
      "info",
    );
    if (wasBusy) {
      ctx.ui.notify(
        "The fork starts from the last completed response; the in-flight turn stays in this session.",
        "info",
      );
    }
  };

  pi.registerCommand("side", {
    description:
      "Fork this session into a new Pi process in a right-hand Ghostty split",
    handler,
  });
}
