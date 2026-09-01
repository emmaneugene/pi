import {
  type AgentSession,
  type AgentSessionEvent,
  AssistantMessageComponent,
  getMarkdownTheme,
  SessionManager,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { markForeignTranscriptComponent } from "../../lib/transcript-component-scope.ts";
import { textContent } from "./content.ts";

export type TranscriptMessage = AgentSession["messages"][number];
type AssistantTranscriptMessage = Extract<
  TranscriptMessage,
  { role: "assistant" }
>;

class ForeignUserMessageComponent extends UserMessageComponent {}
class ForeignAssistantMessageComponent extends AssistantMessageComponent {}
class ForeignToolExecutionComponent extends ToolExecutionComponent {}

markForeignTranscriptComponent(ForeignUserMessageComponent.prototype);
markForeignTranscriptComponent(ForeignAssistantMessageComponent.prototype);
markForeignTranscriptComponent(ForeignToolExecutionComponent.prototype);

export function readDiskSession(file: string): {
  cwd: string;
  messages: TranscriptMessage[];
} {
  const session = SessionManager.open(file);
  return {
    cwd: session.getCwd(),
    messages: session.buildSessionContext().messages as TranscriptMessage[],
  };
}

export class NativeTranscript {
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

  toggleToolsExpanded(): void {
    this.toolsExpanded = !this.toolsExpanded;
    for (const component of this.toolComponents.values()) {
      component.setExpanded(this.toolsExpanded);
    }
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
        const body = textContent(message.content);
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
    const body = textContent(message.content);
    if (body) {
      this.content.addChild(
        new ForeignUserMessageComponent(body, getMarkdownTheme(), 0),
      );
    }
  }

  private addAssistant(
    message: AssistantTranscriptMessage,
  ): AssistantMessageComponent {
    const existing = this.assistantComponents.get(message.timestamp);
    if (existing) return existing;
    const component = new ForeignAssistantMessageComponent(
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
    const component = new ForeignToolExecutionComponent(
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
