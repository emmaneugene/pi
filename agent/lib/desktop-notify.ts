/**
 * Desktop notification engine.
 *
 * Sends a native desktop notification through the one delivery mechanism the
 * current terminal supports. Each terminal maps to exactly ONE mechanism, so
 * a notification never fires twice.
 *
 *   OSC 99  -> kitty                                  (title + body)
 *   OSC 9   -> iTerm2, Rio                            (body only)
 *   OSC 777 -> urxvt, foot, Konsole, WezTerm, Ghostty (title + body)
 *   notif   -> everything else, e.g. Terminal.app, Windows Terminal, Alacritty
 *
 * Lives in agent/lib/ so multiple extensions can share it without importing
 * across extension boundaries.
 */

import { spawn } from "node:child_process";

type NotifySequence = "osc777" | "osc9" | "osc99" | "binary";

const osc777 = (title: string, body: string) =>
  `\x1b]777;notify;${title};${body}\x07`;
const osc9 = (message: string) => `\x1b]9;${message}\x07`;
const osc99 = (message: string) => `\x1b]99;;${message}\x1b\\`;

/**
 * Map the current terminal to a single delivery mechanism. The branches are
 * mutually exclusive and the first match wins, so every terminal resolves to
 * exactly one mechanism (no duplicate notifications). Unknown terminals fall
 * back to the `notif` binary.
 */
const detectSequence = (env = process.env): NotifySequence => {
  const term = (env.TERM ?? "").toLowerCase();
  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
  const has = (...needles: string[]) =>
    needles.some((n) => term.includes(n) || termProgram === n);

  if (env.KITTY_WINDOW_ID || has("kitty")) return "osc99";
  if (has("iterm.app", "rio")) return "osc9";
  if (
    env.KONSOLE_VERSION ||
    env.WEZTERM_PANE ||
    env.GHOSTTY_RESOURCES_DIR ||
    has("rxvt", "foot", "wezterm", "ghostty")
  )
    return "osc777";

  // Unknown terminal: fall back to the `notif` binary.
  return "binary";
};

/**
 * Send a best-effort notification via the `notif` binary
 */
const notifyBinary = (message: string): void => {
  try {
    const child = spawn("notif", ["--persist", message], { stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
};

/**
 * Send a desktop notification using the single mechanism the terminal supports.
 */
export const notify = (title: string, body: string): void => {
  const message = body ? `${title}: ${body}` : title;
  switch (detectSequence()) {
    case "osc777":
      process.stdout.write(osc777(title, body));
      break;
    case "osc9":
      process.stdout.write(osc9(message));
      break;
    case "osc99":
      process.stdout.write(osc99(message));
      break;
    case "binary":
      notifyBinary(message);
      break;
  }
};
