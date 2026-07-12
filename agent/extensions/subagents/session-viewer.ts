import {
  type AgentSession,
  type AgentSessionEvent,
  AssistantMessageComponent,
  type ExtensionCommandContext,
  getMarkdownTheme,
  keyHint,
  type KeybindingsManager,
  SessionManager,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  matchesKey,
  Text,
  truncateToWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import type { AgentRecord, SubagentInvocation } from "./types.ts";

type TranscriptMessage = AgentSession["messages"][number];
type AssistantTranscriptMessage = Extract<
  TranscriptMessage,
  { role: "assistant" }
>;

export type TranscriptSource = {
  title: string;
  invocation?: SubagentInvocation;
  file?: string;
  getSession?: () => AgentSession | undefined;
  getStatus: () => string;
};

const STATUS_ICON: Record<string, string> = {
  running: "●",
  queued: "◌",
  completed: "✓",
  steered: "✓",
  error: "✗",
  aborted: "✗",
  stopped: "■",
  "on disk": "○",
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as any).type === "text" &&
        typeof (part as any).text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function invocationSummary(invocation: SubagentInvocation | undefined): string {
  if (!invocation) return "model unknown · thinking unknown";
  return `${invocation.type} · ${invocation.model.value} · thinking ${invocation.thinking.value}`;
}

function readDiskSession(file: string): {
  cwd: string;
  messages: TranscriptMessage[];
} {
  const session = SessionManager.open(file);
  return {
    cwd: session.getCwd(),
    messages: session.buildSessionContext().messages as TranscriptMessage[],
  };
}

class NativeTranscript {
  private readonly content = new Container();
  private readonly toolComponents = new Map<string, ToolExecutionComponent>();
  private readonly assistantComponents = new Map<
    number,
    AssistantMessageComponent
  >();
  private readonly seenUserMessages = new Set<number>();
  private toolsExpanded = false;

  constructor(
    private readonly tui: TUI,
    private cwd: string,
    private session?: AgentSession,
  ) {}

  setSession(session: AgentSession): void {
    this.session = session;
    this.cwd = session.sessionManager.getCwd();
  }

  render(width: number): string[] {
    return this.content.render(width);
  }

  invalidate(): void {
    this.content.invalidate();
  }

  setToolsExpanded(expanded: boolean): void {
    this.toolsExpanded = expanded;
    for (const component of this.toolComponents.values()) {
      component.setExpanded(expanded);
    }
  }

  toggleToolsExpanded(): void {
    this.setToolsExpanded(!this.toolsExpanded);
  }

  replaceMessages(messages: TranscriptMessage[]): void {
    this.content.clear();
    this.toolComponents.clear();
    this.assistantComponents.clear();
    this.seenUserMessages.clear();

    for (const message of messages) {
      if (message.role === "assistant") {
        this.addAssistant(message);
        for (const part of message.content) {
          if (part.type === "toolCall") {
            this.ensureTool(part.name, part.id, part.arguments);
          }
        }
      } else if (message.role === "toolResult") {
        this.toolComponents.get(message.toolCallId)?.updateResult(message);
      } else if (message.role === "user") {
        this.addUser(message);
      } else if (message.role === "custom" && message.display) {
        const body = textOf(message.content);
        if (body) this.content.addChild(new Text(body, 0, 1));
      }
    }
  }

  handleSessionEvent(event: AgentSessionEvent): void {
    if (event.type === "message_start") {
      if (event.message.role === "assistant") {
        this.addAssistant(event.message);
      } else if (event.message.role === "user") {
        this.addUser(event.message);
      }
    } else if (
      (event.type === "message_update" || event.type === "message_end") &&
      event.message.role === "assistant"
    ) {
      const component = this.addAssistant(event.message);
      component.updateContent(event.message);
      for (const part of event.message.content) {
        if (part.type === "toolCall") {
          const tool = this.ensureTool(part.name, part.id, part.arguments);
          tool.updateArgs(part.arguments);
        }
      }
      if (event.type === "message_end") {
        for (const tool of this.toolComponents.values()) tool.setArgsComplete();
      }
    } else if (event.type === "tool_execution_start") {
      const tool = this.ensureTool(
        event.toolName,
        event.toolCallId,
        event.args,
      );
      tool.markExecutionStarted();
    } else if (event.type === "tool_execution_update") {
      this.toolComponents
        .get(event.toolCallId)
        ?.updateResult({ ...event.partialResult, isError: false }, true);
    } else if (event.type === "tool_execution_end") {
      this.toolComponents
        .get(event.toolCallId)
        ?.updateResult({ ...event.result, isError: event.isError });
    }
  }

  private addUser(message: Extract<TranscriptMessage, { role: "user" }>): void {
    if (this.seenUserMessages.has(message.timestamp)) return;
    this.seenUserMessages.add(message.timestamp);
    const body = textOf(message.content);
    if (body) {
      this.content.addChild(
        new UserMessageComponent(body, getMarkdownTheme(), 0),
      );
    }
  }

  private addAssistant(
    message: AssistantTranscriptMessage,
  ): AssistantMessageComponent {
    const existing = this.assistantComponents.get(message.timestamp);
    if (existing) return existing;
    const component = new AssistantMessageComponent(
      message,
      false,
      getMarkdownTheme(),
      "Thinking…",
      0,
    );
    this.assistantComponents.set(message.timestamp, component);
    this.content.addChild(component);
    return component;
  }

  private ensureTool(
    name: string,
    id: string,
    args: unknown,
  ): ToolExecutionComponent {
    const existing = this.toolComponents.get(id);
    if (existing) return existing;
    const component = new ToolExecutionComponent(
      name,
      id,
      args,
      { showImages: false },
      this.session?.getToolDefinition(name),
      this.tui,
      this.cwd,
    );
    component.setExpanded(this.toolsExpanded);
    this.toolComponents.set(id, component);
    this.content.addChild(component);
    return component;
  }
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

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly source: TranscriptSource,
    private readonly done: () => void,
  ) {
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
      !this.boundSession &&
      (source.getStatus() === "running" || source.getStatus() === "queued")
    ) {
      this.timer = setInterval(() => {
        this.bindAvailableSession();
        this.tui.requestRender();
        if (this.boundSession && this.source.getStatus() !== "queued") {
          this.stopTimer();
        }
      }, 100);
    }
  }

  render(width: number): string[] {
    const height = Math.max(8, this.tui.terminal.rows - 1);
    const bodyHeight = Math.max(3, height - 4);
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
    const icon = STATUS_ICON[status] ?? "·";
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
    const footer = this.theme.fg(
      "dim",
      `↑↓/PgUp/PgDn scroll · End follow · ${keyHint("app.tools.expand", "tools")} · Esc back · ${position}`,
    );
    return [
      title,
      metadata,
      "",
      ...visible,
      truncateToWidth(footer, width, "…"),
    ].map((line) => truncateToWidth(line, width, "…"));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done();
      return;
    }
    if (this.keybindings.matches(data, "app.tools.expand")) {
      this.transcript.toggleToolsExpanded();
    } else if (matchesKey(data, "end")) {
      this.follow = true;
    } else if (matchesKey(data, "home")) {
      this.follow = false;
      this.scrollTop = 0;
    } else if (matchesKey(data, "up")) {
      this.follow = false;
      this.scrollTop--;
    } else if (matchesKey(data, "down")) {
      this.follow = false;
      this.scrollTop++;
    } else if (matchesKey(data, "pageUp")) {
      this.follow = false;
      this.scrollTop -= this.pageSize;
    } else if (matchesKey(data, "pageDown")) {
      this.follow = false;
      this.scrollTop += this.pageSize;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, this.maxScrollTop));
    this.tui.requestRender();
  }

  invalidate(): void {
    this.transcript.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.stopTimer();
  }

  private bindAvailableSession(): void {
    if (this.disposed || this.boundSession) return;
    const session = this.source.getSession?.();
    if (!session) return;
    this.boundSession = session;
    this.transcript.setSession(session);
    this.transcript.replaceMessages(session.messages);
    this.unsubscribe = session.subscribe((event) => {
      this.transcript.handleSessionEvent(event);
      this.follow = this.follow || this.scrollTop >= this.maxScrollTop;
      this.tui.requestRender();
    });
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export async function showSubagentSessionViewer(
  ctx: ExtensionCommandContext,
  source: TranscriptSource,
): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) =>
      new SubagentSessionViewer(tui, theme, keybindings, source, done),
  );
}

export function sourceForRecord(record: AgentRecord): TranscriptSource {
  return {
    title: `${record.type} · ${record.description}`,
    invocation: record.invocation,
    file: record.transcriptFile,
    getSession: () => record.session,
    getStatus: () => record.status,
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
