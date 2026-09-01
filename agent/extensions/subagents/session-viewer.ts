/** Read and steer one child session, live or from disk. */

import {
  type AgentSession,
  type ExtensionContext,
  keyHint,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  NativeTranscript,
  readDiskSession,
  type TranscriptMessage,
} from "./native-transcript.ts";
import {
  statusIcon,
  type AgentRecord,
  type SendMode,
  type SendResult,
  type SubagentInvocation,
} from "./types.ts";

interface TranscriptControls {
  canSend(): boolean;
  send(message: string, mode: SendMode): Promise<SendResult>;
  stop(): boolean;
}

export type TranscriptSource = {
  title: string;
  invocation?: SubagentInvocation;
  file?: string;
  getSession?: () => AgentSession | undefined;
  getStatus: () => string;
  controls?: TranscriptControls;
};

/** The action requested when the viewer closes. */
export type ViewerExit =
  { kind: "close" } | { kind: "navigate"; delta: -1 | 1 };

/** The slice of the manager a viewer needs in order to act on its agent. */
export interface SubagentControls {
  canSend(id: string): boolean;
  send(id: string, message: string, mode: SendMode): Promise<SendResult>;
  abort(id: string, opts?: { userAborted?: boolean }): boolean;
}

function invocationSummary(invocation: SubagentInvocation | undefined): string {
  if (!invocation) return "model unknown · thinking unknown";
  return `${invocation.type} · ${invocation.model.value} · thinking ${invocation.thinking.value}`;
}

export class SubagentSessionViewer {
  private readonly transcript: NativeTranscript;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private boundSession?: AgentSession;
  private scrollTop = 0;
  private maxScrollTop = 0;
  private pageSize = 10;
  private follow = true;
  private disposed = false;
  private loadError?: string;
  private observedStatus: string;
  private readonly composer: Editor;
  private composing = false;
  private notice?: string;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly source: TranscriptSource,
    private readonly done: (exit: ViewerExit) => void,
  ) {
    this.observedStatus = source.getStatus();
    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("borderAccent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    };
    this.composer = new Editor(tui, editorTheme);
    this.composer.onSubmit = (text) => this.deliver(text, "steer");
    let cwd = process.cwd();
    let diskMessages: TranscriptMessage[] = [];
    if (source.file && !source.getSession?.()) {
      try {
        const disk = readDiskSession(source.file);
        cwd = disk.cwd;
        diskMessages = disk.messages;
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : String(error);
      }
    }
    this.transcript = new NativeTranscript(tui, cwd);
    if (diskMessages.length > 0) this.transcript.replaceMessages(diskMessages);
    this.bindAvailableSession();
    if (
      source.getSession &&
      (source.getStatus() === "running" || source.getStatus() === "queued")
    ) {
      this.timer = setInterval(() => {
        const sessionBound = this.bindAvailableSession();
        const status = this.source.getStatus();
        if (sessionBound || status !== this.observedStatus) {
          this.observedStatus = status;
          this.tui.requestRender();
        }
        if (status !== "queued" && status !== "running") this.stopTimer();
      }, 100);
    }
  }

  private canSend(): boolean {
    return this.source.controls?.canSend() ?? false;
  }

  private openComposer(): void {
    if (!this.canSend()) {
      const status = this.source.getStatus();
      this.notice = this.source.controls
        ? status === "running"
          ? "Agent has already finished its work."
          : `Agent is ${status}; it can no longer receive a message.`
        : "This is a stored transcript, not a live agent.";
      return;
    }
    this.composing = true;
    this.notice = undefined;
  }

  private deliver(text: string, mode: SendMode): void {
    const message = text.trim();
    if (!message) {
      this.composing = false;
      return;
    }
    const controls = this.source.controls;
    if (!controls) return;
    this.composer.setText("");
    this.composing = false;
    void controls.send(message, mode).then(
      (result) => {
        this.notice = receiptText(result);
        this.tui.requestRender();
      },
      (error: unknown) => {
        this.notice = `Could not deliver: ${
          error instanceof Error ? error.message : String(error)
        }`;
        this.tui.requestRender();
      },
    );
  }

  render(width: number): string[] {
    const height = Math.max(8, this.tui.terminal.rows);
    const composerLines = this.composing ? this.composer.render(width) : [];
    const noticeLines = this.notice
      ? [truncateToWidth(this.theme.fg("muted", this.notice), width, "…")]
      : [];
    const chromeHeight = 4 + composerLines.length + noticeLines.length;
    const bodyHeight = Math.max(3, height - chromeHeight);
    this.pageSize = bodyHeight;

    let body = this.transcript.render(width);
    if (this.loadError) {
      body = [
        this.theme.fg("error", `Could not load transcript: ${this.loadError}`),
      ];
    } else if (body.length === 0) {
      body = [this.theme.fg("dim", "Waiting for the subagent session…")];
    }

    this.maxScrollTop = Math.max(0, body.length - bodyHeight);
    if (this.follow) this.scrollTop = this.maxScrollTop;
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, this.maxScrollTop));
    const visible = body.slice(this.scrollTop, this.scrollTop + bodyHeight);
    while (visible.length < bodyHeight) visible.push("");

    const status = this.source.getStatus();
    const icon = statusIcon(status);
    const position = this.follow
      ? "following"
      : `${this.scrollTop + 1}-${Math.min(body.length, this.scrollTop + bodyHeight)}/${body.length}`;
    const title = this.theme.bold(
      this.theme.fg("accent", `Subagent · ${this.source.title}`),
    );
    const metadata = this.theme.fg(
      "muted",
      `${icon} ${status} · ${invocationSummary(this.source.invocation)}`,
    );
    const footer = this.theme.fg("dim", `${this.hints()} · ${position}`);
    // The composer's own lines pass through untouched: Editor embeds a cursor
    // marker that clipping and padding would corrupt.
    const fit = (line: string): string => {
      const clipped = truncateToWidth(line, width, "…");
      return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
    };
    return [
      ...[title, metadata, "", ...visible].map(fit),
      ...composerLines,
      ...[...noticeLines, footer].map(fit),
    ];
  }

  private hints(): string {
    if (this.composing) {
      const followUp = keyHint("app.message.followUp", "follow-up");
      return `Enter ${this.source.getStatus() === "queued" ? "queue" : "steer"} · ${followUp} · Esc cancel`;
    }
    const paging =
      this.tui.mode === "fullscreen"
        ? "↑↓/ctrl+u/ctrl+d/Ctrl+PgUp scroll · Ctrl+End follow"
        : "↑↓/ctrl+u/ctrl+d/PgUp scroll · End follow";
    const send = this.canSend() ? "Enter send · ctrl+x stop · " : "";
    return `${paging} · ${keyHint("app.tools.expand", "tools")} · ${send}[ ] prev/next · Esc back`;
  }

  handleInput(data: string): void {
    if (this.composing) {
      this.handleComposerInput(data);
      return;
    }
    if (matchesKey(data, "escape")) {
      this.done({ kind: "close" });
      return;
    }
    if (matchesKey(data, "enter")) {
      this.openComposer();
      this.tui.requestRender();
      return;
    }
    if (data === "[" || data === "]") {
      this.done({ kind: "navigate", delta: data === "[" ? -1 : 1 });
      return;
    }
    if (matchesKey(data, "ctrl+x")) {
      const controls = this.source.controls;
      if (!controls) return;
      if (!this.canSend()) {
        this.notice = "Agent has already finished its work.";
      } else {
        this.notice = controls.stop()
          ? "Subagent stopped."
          : `Could not stop: agent is ${this.source.getStatus()}.`;
      }
      this.tui.requestRender();
      return;
    }
    const half = Math.max(1, Math.floor(this.pageSize / 2));
    if (this.keybindings.matches(data, "app.tools.expand")) {
      this.transcript.toggleToolsExpanded();
    } else if (matchesKey(data, "end") || matchesKey(data, "ctrl+end")) {
      this.scrollByLines(this.maxScrollTop);
    } else if (matchesKey(data, "home") || matchesKey(data, "ctrl+home")) {
      this.scrollByLines(-this.maxScrollTop);
    } else if (matchesKey(data, "up")) {
      this.scrollByLines(-1);
    } else if (matchesKey(data, "down")) {
      this.scrollByLines(1);
    } else if (matchesKey(data, "ctrl+u")) {
      this.scrollByLines(-half);
    } else if (matchesKey(data, "ctrl+d")) {
      this.scrollByLines(half);
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+pageUp")) {
      this.scrollByLines(-this.pageSize);
    } else if (
      matchesKey(data, "pageDown") ||
      matchesKey(data, "ctrl+pageDown")
    ) {
      this.scrollByLines(this.pageSize);
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, this.maxScrollTop));
    this.tui.requestRender();
  }

  /**
   * Composer keys. Escape closes the composer rather than the viewer, so a
   * half-typed message cannot be lost to the same key that leaves the screen.
   */
  private handleComposerInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.composing = false;
    } else if (this.keybindings.matches(data, "app.message.followUp")) {
      this.deliver(this.composer.getExpandedText(), "followUp");
    } else {
      this.composer.handleInput(data);
    }
    this.tui.requestRender();
  }

  invalidate(): void {
    this.transcript.invalidate();
    this.composer.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stopTimer();
  }

  private scrollByLines(lines: number): void {
    this.scrollTop = Math.max(
      0,
      Math.min(this.scrollTop + lines, this.maxScrollTop),
    );
    this.follow = this.scrollTop >= this.maxScrollTop;
    this.tui.requestRender();
  }

  private bindAvailableSession(): boolean {
    if (this.disposed || this.boundSession) return false;
    const session = this.source.getSession?.();
    if (!session) return false;
    this.boundSession = session;
    this.transcript.setSession(session);
    this.transcript.replaceMessages(session.messages);
    this.unsubscribe = session.subscribe((event) => {
      this.transcript.handleSessionEvent(event);
      this.follow = this.follow || this.scrollTop >= this.maxScrollTop;
      this.tui.requestRender();
    });
    return true;
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function receiptText(result: SendResult): string {
  switch (result.kind) {
    case "delivered":
      return result.mode === "followUp"
        ? "Follow-up queued until the current turn ends."
        : "Message added to the current turn.";
    case "queued":
      return "Message queued until the agent starts.";
    case "rejected":
      return result.reason;
  }
}

export async function showSubagentSessionViewer(
  ctx: ExtensionContext,
  source: TranscriptSource,
): Promise<ViewerExit> {
  return ctx.ui.custom<ViewerExit>(
    (tui, theme, keybindings, done) =>
      new SubagentSessionViewer(tui, theme, keybindings, source, done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "top-left",
        width: "100%",
        maxHeight: "100%",
      },
    },
  );
}

export function sourceForRecord(
  record: AgentRecord,
  controls: SubagentControls,
): TranscriptSource {
  return {
    title: `${record.type} · ${record.description}`,
    invocation: record.invocation,
    file: record.transcriptFile,
    getSession: () => record.session,
    getStatus: () => record.status,
    controls: {
      canSend: () => controls.canSend(record.id),
      send: (message, mode) => controls.send(record.id, message, mode),
      stop: () => controls.abort(record.id, { userAborted: true }),
    },
  };
}

export function sourceForTranscript(
  file: string,
  title: string,
  invocation?: SubagentInvocation,
): TranscriptSource {
  return {
    title,
    invocation,
    file,
    getStatus: () => "on disk",
  };
}
