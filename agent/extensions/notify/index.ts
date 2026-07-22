/**
 * Desktop Notification Extension
 *
 * Fires a native desktop notification when the agent finishes and is waiting
 * for input. The delivery engine (terminal detection + OSC/binary dispatch)
 * lives in lib/desktop-notify.ts; this file only wires it to the agent_end
 * event and formats the message.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { notify } from "../../lib/desktop-notify.ts";

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

const MAX_NOTIFICATION_BODY_CODE_POINTS = 200;

/**
 * Reduce common Markdown syntax to a compact desktop-notification preview.
 * This is deliberately not a full Markdown parser: notifications need readable
 * text, not terminal layout or syntax highlighting.
 */
export const markdownToNotificationText = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*(?:`{3,}|~{3,}).*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, "$1")
    .replace(/`+([^`\n]+?)`+/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|(?:[-+*]|\d+[.)])\s+)/gm, "")
    .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
    .replace(/(^|\s)([*_])([^\n]*?\S)\2(?=\s|[.,!?;:]|$)/g, "$1$3")
    .replace(/\s+/g, " ")
    .trim();

export const formatNotification = (
  text: string | null,
): { title: string; body: string } => {
  const normalized = text ? markdownToNotificationText(text) : "";
  if (!normalized) {
    return { title: "Ready for input", body: "" };
  }

  const codePoints = Array.from(normalized);
  const body =
    codePoints.length > MAX_NOTIFICATION_BODY_CODE_POINTS
      ? `${codePoints.slice(0, MAX_NOTIFICATION_BODY_CODE_POINTS - 1).join("")}…`
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
