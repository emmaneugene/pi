export type NotifyType = "info" | "warning" | "error";

export interface UiContext {
  readonly hasUI: boolean;
  readonly ui: {
    setStatus(id: string, text: string | undefined): void;
    notify(message: string, type: NotifyType): void;
  };
}

/** Compaction callbacks may run after ctx is stale; hasUI then throws. */
function withUi(ctx: UiContext, act: (ui: UiContext["ui"]) => void): void {
  try {
    if (ctx.hasUI) act(ctx.ui);
  } catch {
    // Do not crash after session replacement.
  }
}

export function setStatus(ctx: UiContext, text: string | undefined): void {
  withUi(ctx, (ui) => {
    ui.setStatus("autocompact", text);
  });
}

export function notify(
  ctx: UiContext,
  message: string,
  type: NotifyType = "info",
  log: (line: string) => void = console.error,
): void {
  if (type === "warning" || type === "error") {
    log(`[autocompact] ${message}`);
  }
  withUi(ctx, (ui) => {
    ui.notify(message, type);
  });
}
