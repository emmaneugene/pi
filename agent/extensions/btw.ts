/**
 * Pi extension: `/btw` — side conversations
 *
 * Lets you hold a parallel conversation with the LLM while the main agent is
 * running, without interrupting it. The main agent never sees the side thread.
 *
 * ## Commands
 *
 * | Command | Description |
 * |---------|-------------|
 * | `/btw <message>` | Send a message in the side conversation. Streams the response in a widget above the editor. Async — works while the main agent is busy. |
 * | `/btw:new [message]` | Start a fresh side thread. Optionally kick it off with a message. |
 * | `/btw:clear` | Dismiss the widget and reset the thread. |
 * | `/btw:inject [instructions]` | Inject the full btw thread into the main agent's context as a follow-up user message. |
 * | `/btw:summarize [instructions]` | LLM-summarise the thread (low reasoning) then inject the summary. |
 *
 * ## Context building
 *
 * Each `/btw` call receives:
 * 1. All main-session messages (user + assistant text only) for context.
 * 2. All prior btw Q&As in the current thread (continuous by default).
 * 3. The new question.
 *
 * A system prompt frames it as an aside so the btw agent doesn't try to
 * continue or complete main-session work.
 *
 * ## Persistence
 *
 * Completed exchanges are stored in the session JSONL as `custom` entries
 * (`btw` type). Thread resets are stored as `btw-reset` markers. Neither type
 * appears in the TUI conversation or the main agent's LLM context. On session
 * restore the `session_start` handler reconstructs thread state from entries
 * after the latest reset marker and rehydrates the widget.
 */
import { streamSimple, completeSimple, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

/** Persisted record for a completed btw exchange, stored via `appendEntry`. */
interface BtwDetails {
  question: string;
  thinking: string;
  answer: string;
  /** `"provider/model-id"` label of the model used for this exchange. */
  model: string;
}

/**
 * In-memory state for a single `/btw` call while it is streaming.
 * One slot is created per call; all slots render into the btw widget.
 */
interface BtwSlot {
  question: string;
  model: string;
  thinking: string;
  answer: string;
  /** `true` once the stream has finished (or errored). */
  done: boolean;
}

const BTW_TYPE = "btw";

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * /btw <question>      — Side conversation, streams answer in a widget
 * /btw:new <question>   — Fresh btw thread
 * /btw:clear            — Dismiss the widget
 * /btw:inject [msg]     — Inject full btw thread into main agent context
 * /btw:summarize [msg]  — Summarize btw thread and inject into main agent context
 */
export default function (pi: ExtensionAPI) {
  let btwThreadStart = 0;
  const pendingBtwThread: BtwDetails[] = [];

  // Active widget slots — each /btw call gets one, streams into it
  const slots: BtwSlot[] = [];
  let widgetStatus: string | null = null;

  // ── Restore state from session on reload/restart ─────────────────

  const BTW_RESET_TYPE = "btw-reset";

  pi.on("session_start", async (_event, ctx) => {
    pendingBtwThread.length = 0;
    slots.length = 0;
    btwThreadStart = 0;

    // Find the latest reset marker to know which btw entries are active
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && (entry as any).customType === BTW_RESET_TYPE) {
        btwThreadStart = (entry as any).data?.timestamp ?? 0;
      }
    }

    // Reconstruct thread from entries after the last reset
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || (entry as any).customType !== BTW_TYPE) continue;
      const entryTime = Date.parse(entry.timestamp) || 0;
      if (entryTime <= btwThreadStart) continue;
      const data = (entry as any).data as BtwDetails | undefined;
      if (data?.question && data?.answer && !data.answer.startsWith("❌")) {
        pendingBtwThread.push(data);
        slots.push({
          question: data.question,
          model: data.model,
          thinking: data.thinking || "",
          answer: data.answer,
          done: true,
        });
      }
    }

    if (slots.length > 0) {
      renderWidget(ctx);
    }
  });

  // ── Widget rendering ─────────────────────────────────────────────

  /**
   * (Re-)render the btw widget above the editor.
   *
   * - Clears the widget when there are no slots.
   * - Renders each slot separated by a `───` divider.
   * - Shows a streaming cursor `▍` while thinking or answering.
   * - Appends `widgetStatus` (e.g. `"⏳ summarizing..."`) when set.
   */
  function renderWidget(ctx: ExtensionContext) {
    if (slots.length === 0) {
      ctx.ui.setWidget("btw", undefined);
      return;
    }

    ctx.ui.setWidget(
      "btw",
      (_tui, theme) => {
        const dim = (s: string) => theme.fg("dim", s);
        const green = (s: string) => theme.fg("success", s);
        const italic = (s: string) => theme.fg("dim", theme.italic(s));
        const yellow = (s: string) => theme.fg("warning", s);

        const parts: string[] = [];

        const title = " 💭 btw ";
        const hint = " /btw:clear to dismiss ";
        const pad = Math.max(0, 50 - title.length - hint.length);
        parts.push(dim(`╭${title}${"─".repeat(pad)}${hint}╮`));

        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (i > 0) parts.push(dim("│ ───"));
          parts.push(dim("│ ") + green("› ") + s.question);
          if (s.thinking) {
            const cursor = !s.answer && !s.done ? yellow(" ▍") : "";
            parts.push(dim("│ ") + italic(s.thinking) + cursor);
          }
          if (s.answer) {
            const answerLines = s.answer.split("\n");
            parts.push(dim("│ ") + answerLines[0]);
            if (answerLines.length > 1) {
              parts.push(answerLines.slice(1).join("\n"));
            }
            if (!s.done) parts[parts.length - 1] += yellow(" ▍");
          } else if (!s.thinking && !s.done) {
            parts.push(dim("│ ") + yellow("⏳ thinking..."));
          }
        }

        if (widgetStatus) {
          parts.push(dim("│ ") + yellow(widgetStatus));
        }

        parts.push(dim(`╰${"─".repeat(50)}╯`));

        return new Text(parts.join("\n"), 0, 0);
      },
      { placement: "aboveEditor" },
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Reset the btw thread.
   *
   * Clears all in-memory state (slots, pending thread, status) and persists a
   * `btw-reset` marker so the reset survives a session restart. Also clears
   * the widget.
   */
  function resetThread(ctx: ExtensionContext) {
    btwThreadStart = Date.now();
    pendingBtwThread.length = 0;
    slots.length = 0;
    widgetStatus = null;
    pi.appendEntry(BTW_RESET_TYPE, { timestamp: btwThreadStart });
    renderWidget(ctx);
  }

  /**
   * Return the active btw thread, excluding any errored exchanges.
   *
   * `pendingBtwThread` is the source of truth — it is reconstructed from the
   * session on startup and appended to live as exchanges complete.
   */
  function collectBtwThread(): BtwDetails[] {
    return pendingBtwThread.filter((d) => !d.answer.startsWith("❌"));
  }

  /** Serialise a btw thread into a plain `User: … / Assistant: …` string for injection. */
  function formatThread(thread: BtwDetails[]): string {
    return thread
      .map((d) => `User: ${d.question.trim()}\nAssistant: ${d.answer.trim()}`)
      .join("\n\n---\n\n");
  }

  /**
   * Extract text-only user + assistant messages from the current session branch.
   *
   * Tool calls, tool results, bash executions, and summaries are omitted — the
   * btw agent only needs the conversational narrative for context.
   */
  function buildMainMessages(ctx: ExtensionContext, model: any): Message[] {
    const messages: Message[] = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = (entry as any).message;
      if (!msg) continue;

      if (msg.role === "user") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : (msg.content ?? [])
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");
        if (content) {
          messages.push({
            role: "user",
            content: [{ type: "text", text: content }],
            timestamp: msg.timestamp ?? Date.now(),
          });
        }
      } else if (msg.role === "assistant") {
        const content = (msg.content ?? [])
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
        if (content) {
          messages.push({
            role: "assistant",
            content: [{ type: "text", text: content }],
            model: msg.model ?? model.id,
            provider: msg.provider ?? model.provider,
            api: msg.api ?? "",
            usage: msg.usage ?? emptyUsage,
            stopReason: "stop",
            timestamp: msg.timestamp ?? Date.now(),
          });
        }
      }
    }
    return messages;
  }

  /**
   * Build the full message list for a btw LLM call:
   * 1. Main session messages (context only).
   * 2. A synthetic user/assistant pair that frames the side-conversation
   *    thread (omitted when the thread is empty).
   * 3. Prior btw Q&A pairs for conversational continuity.
   * 4. The new question as the final user message.
   */
  function buildBtwMessages(ctx: ExtensionContext, model: any, question: string): Message[] {
    const mainMessages = buildMainMessages(ctx, model);
    const thread = collectBtwThread();
    const all: Message[] = [...mainMessages];

    if (thread.length > 0) {
      all.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "[The following is a separate side conversation. Continue this thread.]",
          },
        ],
        timestamp: Date.now(),
      });
      all.push({
        role: "assistant",
        content: [{ type: "text", text: "Understood, continuing our side conversation." }],
        model: model.id,
        provider: model.provider,
        api: "",
        usage: emptyUsage,
        stopReason: "stop",
        timestamp: Date.now(),
      });
      for (const d of thread) {
        all.push({
          role: "user",
          content: [{ type: "text", text: d.question }],
          timestamp: Date.now(),
        });
        all.push({
          role: "assistant",
          content: [{ type: "text", text: d.answer }],
          model: model.id,
          provider: model.provider,
          api: "",
          usage: emptyUsage,
          stopReason: "stop",
          timestamp: Date.now(),
        });
      }
    }

    all.push({
      role: "user",
      content: [{ type: "text", text: question }],
      timestamp: Date.now(),
    });

    return all;
  }

  /**
   * Fire a btw request for `question`.
   *
   * Creates a new widget slot, streams the response into it (thinking delta →
   * text delta), then persists the completed exchange via `appendEntry` and
   * pushes it onto `pendingBtwThread` for continuity in subsequent calls.
   * Errors are surfaced inline in the slot rather than thrown.
   */
  function fireBtw(ctx: ExtensionContext, question: string) {
    const model = ctx.model;
    if (!model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    const thinkingLevel = pi.getThinkingLevel();
    const modelLabel = `${model.provider}/${model.id}`;
    const allMessages = buildBtwMessages(ctx, model, question);

    // Create a slot for this btw call
    const slot: BtwSlot = { question, model: modelLabel, thinking: "", answer: "", done: false };
    slots.push(slot);
    renderWidget(ctx);

    (async () => {
      try {
        const apiKey = await ctx.modelRegistry.getApiKey(model);
        if (!apiKey) {
          slot.answer = "❌ No API key";
          slot.done = true;
          renderWidget(ctx);
          return;
        }

        const eventStream = streamSimple(
          model,
          {
            systemPrompt:
              "You are having an aside conversation with the user, separate from their main working session. The main session messages are provided for context only — that work is being handled by another agent. Focus on answering the user's side questions, helping them think through ideas, or planning next steps. Do not act as if you need to complete or continue the main session's work.",
            messages: allMessages,
          },
          { apiKey, reasoning: thinkingLevel },
        );

        for await (const event of eventStream) {
          if (event.type === "thinking_delta") {
            slot.thinking += event.delta;
            renderWidget(ctx);
          } else if (event.type === "text_delta") {
            slot.answer += event.delta;
            renderWidget(ctx);
          } else if (event.type === "error") {
            slot.answer += `\n❌ ${event.error.message}`;
            slot.done = true;
            renderWidget(ctx);
            return;
          }
        }

        slot.done = true;
        renderWidget(ctx);

        const details = {
          question,
          thinking: slot.thinking,
          answer: slot.answer,
          model: modelLabel,
        } satisfies BtwDetails;
        pendingBtwThread.push(details);

        // Persist in session (hidden from TUI, filtered from agent context)
        pi.appendEntry(BTW_TYPE, details);
      } catch (err: any) {
        slot.answer = `❌ ${err.message}`;
        slot.done = true;
        renderWidget(ctx);
      }
    })();
  }

  // Note: btw entries are stored via appendEntry (custom type, not in LLM context)
  // No context filter needed — custom entries don't participate in LLM context

  // ── Commands ─────────────────────────────────────────────────────

  pi.registerCommand("btw", {
    description: "Ask a side question using current context (works async while agent is busy)",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (!question) {
        ctx.ui.notify("Usage: /btw <question>", "warning");
        return;
      }
      fireBtw(ctx, question);
    },
  });

  pi.registerCommand("btw:new", {
    description: "Start a fresh btw thread, optionally with a new question",
    handler: async (args, ctx) => {
      resetThread(ctx);
      const question = args.trim();
      if (question) {
        fireBtw(ctx, question);
      } else {
        ctx.ui.notify("💭 btw: started fresh thread", "info");
      }
    },
  });

  pi.registerCommand("btw:clear", {
    description: "Dismiss the btw widget and clear thread",
    handler: async (_args, ctx) => {
      resetThread(ctx);
    },
  });

  pi.registerCommand("btw:inject", {
    description:
      "Inject btw thread into main agent context (queued as follow-up if busy) [optional instructions]",
    handler: async (args, ctx) => {
      const thread = collectBtwThread();
      if (thread.length === 0 || slots.length === 0) {
        ctx.ui.notify("No active btw thread to inject", "warning");
        return;
      }

      const instructions = args.trim();
      const threadText = formatThread(thread);
      const content = instructions
        ? `Here's a side conversation I had. ${instructions}\n\n<btw-thread>\n${threadText}\n</btw-thread>`
        : `Here's a side conversation I had for additional context:\n\n<btw-thread>\n${threadText}\n</btw-thread>`;

      pi.sendUserMessage(content, { deliverAs: "followUp" });
      resetThread(ctx);
      ctx.ui.notify(`💭 btw → main: injected ${thread.length} exchange(s)`, "info");
    },
  });

  pi.registerCommand("btw:summarize", {
    description:
      "Summarize btw thread and inject into main agent (queued as follow-up if busy) [optional instructions]",
    handler: async (args, ctx) => {
      const thread = collectBtwThread();
      if (thread.length === 0 || slots.length === 0) {
        ctx.ui.notify("No active btw thread to summarize", "warning");
        return;
      }

      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const apiKey = await ctx.modelRegistry.getApiKey(model);
      if (!apiKey) {
        ctx.ui.notify(`No API key for ${model.provider}/${model.id}`, "error");
        return;
      }

      widgetStatus = "⏳ summarizing...";
      renderWidget(ctx);

      try {
        const threadText = formatThread(thread);
        const response = await completeSimple(
          model,
          {
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: [
                      "Summarize this side conversation concisely. Preserve key decisions, plans, insights, and action items.",
                      "Output only the summary, no preamble.",
                      "",
                      "<btw-thread>",
                      threadText,
                      "</btw-thread>",
                    ].join("\n"),
                  },
                ],
                timestamp: Date.now(),
              },
            ],
          },
          { apiKey, reasoning: "low" },
        );

        const summary = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        const instructions = args.trim();
        const content = instructions
          ? `Here's a summary of a side conversation I had. ${instructions}\n\n<btw-summary>\n${summary}\n</btw-summary>`
          : `Here's a summary of a side conversation I had:\n\n<btw-summary>\n${summary}\n</btw-summary>`;

        pi.sendUserMessage(content, { deliverAs: "followUp" });

        resetThread(ctx);
        ctx.ui.notify(`💭 btw → main: injected summary of ${thread.length} exchange(s)`, "info");
      } catch (err: any) {
        widgetStatus = null;
        renderWidget(ctx);
        ctx.ui.notify(`btw:summarize error — ${err.message}`, "error");
      }
    },
  });
}
