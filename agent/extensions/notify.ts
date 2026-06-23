/**
 * Desktop Notification Extension
 *
 * Sends a native desktop notification when the agent finishes and is waiting for input.
 * Each terminal is mapped to exactly ONE delivery mechanism, so a single
 * notification never fires twice.
 *
 * Coverage (mutually exclusive):
 *   OSC 99  -> kitty                                  (title + body)
 *   OSC 9   -> iTerm2, Rio                            (body only)
 *   OSC 777 -> urxvt, foot, Konsole, WezTerm, Ghostty (title + body)
 *   notif   -> everything else, e.g. Terminal.app, Windows Terminal, Alacritty
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

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
    const child = spawn("notif", [message], { stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
};

/**
 * Send a desktop notification using the single mechanism the terminal supports.
 */
const notify = (title: string, body: string): void => {
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

const isTextPart = (part: unknown): part is { type: "text"; text: string } =>
  Boolean(
    part &&
    typeof part === "object" &&
    "type" in part &&
    part.type === "text" &&
    "text" in part,
  );

const extractLastAssistantText = (
  messages: Array<{ role?: string; content?: unknown }>,
): string | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") {
      continue;
    }

    const content = message.content;
    if (typeof content === "string") {
      return content.trim() || null;
    }

    if (Array.isArray(content)) {
      const text = content
        .filter(isTextPart)
        .map((part) => part.text)
        .join("\n")
        .trim();
      return text || null;
    }

    return null;
  }

  return null;
};

const plainMarkdownTheme: MarkdownTheme = {
  heading: (text) => text,
  link: (text) => text,
  linkUrl: () => "",
  code: (text) => text,
  codeBlock: (text) => text,
  codeBlockBorder: () => "",
  quote: (text) => text,
  quoteBorder: () => "",
  hr: () => "",
  listBullet: () => "",
  bold: (text) => text,
  italic: (text) => text,
  strikethrough: (text) => text,
  underline: (text) => text,
};

const simpleMarkdown = (text: string, width = 80): string => {
  const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
  return markdown.render(width).join("\n");
};

const formatNotification = (
  text: string | null,
): { title: string; body: string } => {
  const simplified = text ? simpleMarkdown(text) : "";
  const normalized = simplified.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { title: "Ready for input", body: "" };
  }

  const maxBody = 200;
  const body =
    normalized.length > maxBody
      ? `${normalized.slice(0, maxBody - 1)}…`
      : normalized;
  return { title: "π", body };
};

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (event) => {
    const lastText = extractLastAssistantText(event.messages ?? []);
    const { title, body } = formatNotification(lastText);
    notify(title, body);
  });
}
