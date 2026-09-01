import {
  type ExtensionAPI,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";

export const SUBAGENT_NOTIFICATION_TYPE = "subagent-notification";

export function notificationHeadline(content: string): string {
  return content.split("\n", 1)[0]?.trim() ?? "";
}

export function registerNotificationRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(
    SUBAGENT_NOTIFICATION_TYPE,
    (message, { expanded, outputPad }, theme) => {
      if (typeof message.content !== "string") return undefined;

      const box = new Box(outputPad, 0, (text) =>
        theme.bg("customMessageBg", text),
      );
      box.addChild(
        expanded
          ? new Markdown(message.content, 0, 0, getMarkdownTheme())
          : new Text(notificationHeadline(message.content), 0, 0),
      );
      return box;
    },
  );
}
