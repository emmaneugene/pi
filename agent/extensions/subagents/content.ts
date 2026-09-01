import type { AgentSession } from "@earendil-works/pi-coding-agent";

type ContentMode = "text" | "transcript";

function renderContent(content: unknown, mode: ContentMode): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((value): string[] => {
      if (!value || typeof value !== "object") return [];
      const part = value as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") {
        return [part.text];
      }
      if (mode === "transcript" && part.type === "toolCall") {
        return [`[tool call: ${String(part.name ?? part.toolName ?? "?")}]`];
      }
      return [];
    })
    .join("");
}

export const textContent = (content: unknown): string =>
  renderContent(content, "text");

export const transcriptContent = (content: unknown): string =>
  renderContent(content, "transcript");

/**
 * Text of the assistant message currently being streamed, or "" when nothing
 * is in flight. Keeps the reach into `agent.state`, and its shape guard, in
 * one place.
 *
 * Callers apply their own clipping. That clipping differs by caller: a
 * multi-line snapshot for the model, a single row in the terminal.
 */
export function streamingText(session: AgentSession | undefined): string {
  const message = session?.agent.state.streamingMessage;
  if (!message || !("content" in message)) return "";
  return textContent(message.content);
}
