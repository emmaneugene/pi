import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { notify } from "../../../lib/desktop-notify.ts";
import { modalPriority } from "../../../lib/tui/modal-priority.ts";
import {
  type Answer,
  findQuestionError,
  formatAskUserQuestionResult,
  hasAnswer,
  normalizeQuestions,
  type NormalizedQuestion,
  AskUserQuestionParamsSchema,
  type AskUserQuestionResult,
  type Question,
  type QuestionOption,
} from "./model.ts";

type RenderOption =
  (QuestionOption & { kind: "option" }) | { kind: "other"; label: "Other" };

type View =
  | { kind: "question"; questionIndex: number; optionIndex: number }
  | { kind: "custom"; questionIndex: number; optionIndex: number }
  | { kind: "submit" };

function errorResult(message: string): {
  content: { type: "text"; text: string }[];
  details: AskUserQuestionResult;
} {
  return {
    content: [{ type: "text", text: message }],
    details: { questions: [], answers: [], cancelled: true },
  };
}

export default function askUserQuestion(pi: ExtensionAPI) {
  pi.registerTool({
    name: "AskUserQuestion",
    label: "Ask User Question",
    description: `Collect structured multiple-choice answers from the user. Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.

Usage notes:
- Each question should have at least 2 options for the user to choose from
- Users will always be able to select "Other" to provide custom text input
- Use allow_multiple: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Prefer this tool over listing options in your final response text (as letters, numbers, bullet points, etc).`,
    parameters: AskUserQuestionParamsSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult(
          "Error: UI not available (running in non-interactive mode)",
        );
      }

      const questionError = findQuestionError(params.questions);
      if (questionError) return errorResult(`Error: ${questionError}`);

      const questions = normalizeQuestions(params.questions);
      if (!(await modalPriority.wait(_signal))) {
        return errorResult("AskUserQuestion was cancelled before it opened.");
      }
      // Keep the path from this wait to ui.custom synchronous. An await here
      // could let a command catalog open before the question mounts.

      const count = questions.length;
      const firstPrompt = questions[0]?.prompt ?? "";
      notify(
        `Question${count === 1 ? "" : "s"} for you`,
        count === 1
          ? firstPrompt
          : `${count} questions, starting with: ${firstPrompt}`,
      );

      const showTabs =
        questions.length > 1 || questions.some((q) => q.allow_multiple);
      const totalTabs = questions.length + 1;

      const result = await ctx.ui.custom<AskUserQuestionResult>(
        (tui, theme, _keybindings, done) => {
          let view: View = {
            kind: "question",
            questionIndex: 0,
            optionIndex: 0,
          };
          let cachedLines: string[] | undefined;
          let cachedWidth: number | undefined;
          let customError = false;
          const answers = new Map<string, Answer>();

          const editorTheme: EditorTheme = {
            borderColor: (text) => theme.fg("accent", text),
            selectList: {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          };
          const editor = new Editor(tui, editorTheme);

          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          function orderedAnswers(): Answer[] {
            return questions.flatMap((question) => {
              const answer = answers.get(question.id);
              return answer ? [answer] : [];
            });
          }

          function submit(cancelled: boolean) {
            done({ questions, answers: orderedAnswers(), cancelled });
          }

          const onAbort = () => submit(true);
          _signal?.addEventListener("abort", onAbort, { once: true });

          function currentQuestion(): NormalizedQuestion | undefined {
            return view.kind === "submit"
              ? undefined
              : questions[view.questionIndex];
          }

          function currentOptions(): RenderOption[] {
            const question = currentQuestion();
            if (!question) return [];
            return [
              ...question.options.map((option) => ({
                ...option,
                kind: "option" as const,
              })),
              { kind: "other", label: "Other" },
            ];
          }

          function allAnswered(): boolean {
            return questions.every((question) =>
              hasAnswer(answers.get(question.id)),
            );
          }

          function showQuestion(questionIndex: number) {
            view = { kind: "question", questionIndex, optionIndex: 0 };
            refresh();
          }

          function advanceAfterSingleAnswer(questionIndex: number) {
            if (questions.length === 1) {
              submit(false);
              return;
            }
            if (questionIndex < questions.length - 1) {
              showQuestion(questionIndex + 1);
              return;
            }
            view = { kind: "submit" };
            refresh();
          }

          function getOrCreateAnswer(questionId: string): Answer {
            return answers.get(questionId) ?? { questionId, optionIds: [] };
          }

          function storeAnswer(answer: Answer) {
            if (hasAnswer(answer)) answers.set(answer.questionId, answer);
            else answers.delete(answer.questionId);
          }

          function toggleOption(questionId: string, optionId: string) {
            const answer = getOrCreateAnswer(questionId);
            const existingIndex = answer.optionIds.indexOf(optionId);
            if (existingIndex >= 0) answer.optionIds.splice(existingIndex, 1);
            else answer.optionIds.push(optionId);
            storeAnswer(answer);
          }

          function openCustomInput(questionIndex: number, optionIndex: number) {
            const question = questions[questionIndex];
            const existingText = answers.get(question.id)?.customText ?? "";
            view = { kind: "custom", questionIndex, optionIndex };
            customError = false;
            editor.setText(existingText);
            refresh();
          }

          editor.onSubmit = (value) => {
            if (view.kind !== "custom") return;
            const trimmed = value.trim();
            if (!trimmed) {
              customError = true;
              refresh();
              return;
            }

            const questionIndex = view.questionIndex;
            const question = questions[questionIndex];
            const answer = question.allow_multiple
              ? getOrCreateAnswer(question.id)
              : { questionId: question.id, optionIds: [] };
            answer.customText = trimmed;
            answers.set(question.id, answer);
            editor.setText("");
            customError = false;

            if (question.allow_multiple) {
              showQuestion(questionIndex);
            } else {
              advanceAfterSingleAnswer(questionIndex);
            }
          };

          function navigateTabs(delta: number) {
            const currentTab =
              view.kind === "submit" ? questions.length : view.questionIndex;
            const nextTab = (currentTab + delta + totalTabs) % totalTabs;
            view =
              nextTab === questions.length
                ? { kind: "submit" }
                : { kind: "question", questionIndex: nextTab, optionIndex: 0 };
            refresh();
          }

          function handleInput(data: string) {
            if (view.kind === "custom") {
              if (matchesKey(data, Key.escape)) {
                const { questionIndex, optionIndex } = view;
                editor.setText("");
                customError = false;
                view = { kind: "question", questionIndex, optionIndex };
                refresh();
                return;
              }
              customError = false;
              editor.handleInput(data);
              refresh();
              return;
            }

            if (showTabs) {
              if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
                navigateTabs(1);
                return;
              }
              if (
                matchesKey(data, Key.shift("tab")) ||
                matchesKey(data, Key.left)
              ) {
                navigateTabs(-1);
                return;
              }
            }

            if (view.kind === "submit") {
              if (matchesKey(data, Key.enter) && allAnswered()) submit(false);
              else if (matchesKey(data, Key.escape)) submit(true);
              return;
            }

            const question = questions[view.questionIndex];
            const options = currentOptions();

            if (matchesKey(data, Key.up)) {
              view.optionIndex = Math.max(0, view.optionIndex - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              view.optionIndex = Math.min(
                options.length - 1,
                view.optionIndex + 1,
              );
              refresh();
              return;
            }

            const isSpace = matchesKey(data, Key.space);
            const isSelectionKey =
              matchesKey(data, Key.enter) ||
              (question.allow_multiple && isSpace);
            if (isSelectionKey) {
              const option = options[view.optionIndex];
              if (option.kind === "other") {
                const answer = answers.get(question.id);
                if (
                  question.allow_multiple &&
                  isSpace &&
                  answer?.customText !== undefined
                ) {
                  delete answer.customText;
                  storeAnswer(answer);
                  refresh();
                } else {
                  openCustomInput(view.questionIndex, view.optionIndex);
                }
                return;
              }
              if (question.allow_multiple) {
                toggleOption(question.id, option.id);
                refresh();
              } else {
                answers.set(question.id, {
                  questionId: question.id,
                  optionIds: [option.id],
                });
                advanceAfterSingleAnswer(view.questionIndex);
              }
              return;
            }

            if (matchesKey(data, Key.escape)) submit(true);
          }

          function render(width: number): string[] {
            if (cachedLines && cachedWidth === width) return cachedLines;

            const renderWidth = Math.max(1, width);
            const lines: string[] = [];
            const question = currentQuestion();
            const options = currentOptions();

            function add(text: string) {
              lines.push(...wrapTextWithAnsi(text, renderWidth));
            }

            function addWithPrefix(prefix: string, text: string) {
              const prefixWidth = visibleWidth(prefix);
              if (prefixWidth >= renderWidth) {
                add(prefix + text);
                return;
              }
              const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
              const continuation = " ".repeat(prefixWidth);
              wrapped.forEach((line, index) => {
                lines.push(`${index === 0 ? prefix : continuation}${line}`);
              });
            }

            add(theme.fg("accent", "─".repeat(renderWidth)));

            if (params.title) {
              addWithPrefix(" ", theme.fg("text", theme.bold(params.title)));
              lines.push("");
            }

            if (showTabs) {
              const tabs: string[] = ["← "];
              questions.forEach((tabQuestion, index) => {
                const active =
                  view.kind !== "submit" && view.questionIndex === index;
                const answered = hasAnswer(answers.get(tabQuestion.id));
                const text = ` ${answered ? "■" : "□"} ${tabQuestion.id} `;
                tabs.push(
                  active
                    ? theme.bg("selectedBg", theme.fg("text", text))
                    : theme.fg(answered ? "success" : "muted", text),
                );
                tabs.push(" ");
              });
              const submitText = " ✓ Submit ";
              tabs.push(
                view.kind === "submit"
                  ? theme.bg("selectedBg", theme.fg("text", submitText))
                  : theme.fg(allAnswered() ? "success" : "dim", submitText),
              );
              tabs.push(" →");
              addWithPrefix(" ", tabs.join(""));
              lines.push("");
            }

            function renderOptions() {
              if (!question || view.kind === "submit") return;
              const answer = answers.get(question.id);
              const optionIndex = view.optionIndex;
              options.forEach((option, index) => {
                const focused = index === optionIndex;
                const checked =
                  option.kind === "other"
                    ? answer?.customText !== undefined
                    : answer?.optionIds.includes(option.id) === true;
                const cursor = focused ? theme.fg("accent", "> ") : "  ";
                const marker = question.allow_multiple
                  ? checked
                    ? "[x] "
                    : "[ ] "
                  : `${index + 1}. `;
                const optionText =
                  option.kind === "other" && answer?.customText
                    ? `${option.label}: ${answer.customText}`
                    : option.label;
                addWithPrefix(
                  cursor,
                  theme.fg(focused ? "accent" : "text", marker + optionText),
                );
              });
            }

            if (view.kind === "submit") {
              addWithPrefix(
                " ",
                theme.fg("accent", theme.bold("Ready to submit")),
              );
              lines.push("");
              questions.forEach((summaryQuestion) => {
                const answer = answers.get(summaryQuestion.id);
                if (!answer) return;
                const values = answer.optionIds.map(
                  (id) =>
                    summaryQuestion.options.find((option) => option.id === id)
                      ?.label ?? id,
                );
                if (answer.customText !== undefined) {
                  values.push(`Other: ${answer.customText}`);
                }
                addWithPrefix(
                  " ",
                  `${theme.fg("muted", `${summaryQuestion.id}: `)}${theme.fg("text", values.join(", "))}`,
                );
              });
              lines.push("");
              if (allAnswered()) {
                addWithPrefix(
                  " ",
                  theme.fg("success", "Press Enter to submit"),
                );
              } else {
                const missing = questions
                  .filter((candidate) => !hasAnswer(answers.get(candidate.id)))
                  .map((candidate) => candidate.id)
                  .join(", ");
                addWithPrefix(
                  " ",
                  theme.fg("warning", `Unanswered: ${missing}`),
                );
              }
            } else if (question) {
              addWithPrefix(" ", theme.fg("text", question.prompt));
              lines.push("");
              renderOptions();

              if (view.kind === "custom") {
                lines.push("");
                addWithPrefix(" ", theme.fg("muted", "Other answer:"));
                editor
                  .render(Math.max(1, renderWidth - 2))
                  .forEach((line) => addWithPrefix(" ", line));
                if (customError) {
                  addWithPrefix(
                    " ",
                    theme.fg("warning", "Enter a response before you submit."),
                  );
                }
                lines.push("");
                addWithPrefix(
                  " ",
                  theme.fg("dim", "Enter to save • Esc to go back"),
                );
              }
            }

            lines.push("");
            if (view.kind !== "custom") {
              const help = showTabs
                ? question?.allow_multiple
                  ? "Tab/←→ navigate • ↑↓ select • Space/Enter toggle • Esc cancel"
                  : "Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
                : "↑↓ navigate • Enter select • Esc cancel";
              addWithPrefix(" ", theme.fg("dim", help));
            }
            add(theme.fg("accent", "─".repeat(renderWidth)));

            cachedLines = lines;
            cachedWidth = width;
            return lines;
          }

          let focused = false;
          const component: Component & Focusable & { dispose(): void } = {
            get focused() {
              return focused;
            },
            set focused(value) {
              focused = value;
              editor.focused = value;
              cachedLines = undefined;
            },
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
            dispose: () => _signal?.removeEventListener("abort", onAbort),
          };
          return component;
        },
      );

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled AskUserQuestion" }],
          details: result,
        };
      }

      return {
        content: [
          { type: "text", text: formatAskUserQuestionResult(result.answers) },
        ],
        details: result,
      };
    },

    renderCall(args, theme, _context) {
      const questions = (args.questions as Question[]) || [];
      const count = questions.length;
      const ids = questions.map((question) => question.id).join(", ");
      let text = theme.fg("toolTitle", theme.bold("AskUserQuestion "));
      text += theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
      if (ids) text += theme.fg("dim", ` (${truncateToWidth(ids, 40)})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as AskUserQuestionResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }

      const lines = details.answers.map((answer) => {
        const question = details.questions.find(
          (candidate) => candidate.id === answer.questionId,
        );
        const values = answer.optionIds.map(
          (id) =>
            question?.options.find((option) => option.id === id)?.label ?? id,
        );
        if (answer.customText !== undefined) {
          values.push(`Other: ${answer.customText}`);
        }
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.questionId)}: ${values.join(", ")}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
