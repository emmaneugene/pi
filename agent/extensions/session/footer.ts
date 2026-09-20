import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// Pi sorts footer statuses by key. This key keeps the ID before autocompact.
const STATUS_KEY = "00-session-id";

function showSessionId(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(
    STATUS_KEY,
    ctx.ui.theme.fg("dim", ctx.sessionManager.getSessionId()),
  );
}

export default function sessionFooter(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    showSessionId(ctx);
  });
}
