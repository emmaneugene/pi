import { describe, expect, it } from "vitest";
import {
  findQuestionError,
  formatAskUserQuestionResult,
  hasAnswer,
  normalizeQuestions,
  type Answer,
  type Question,
} from "../model.ts";

const question: Question = {
  id: "config_areas",
  prompt: "Which areas?",
  options: [
    { id: "editor_settings", label: "Editor settings" },
    { id: "user_rules", label: "User rules" },
  ],
};

describe("AskUserQuestion model", () => {
  it("defaults questions to single-select", () => {
    expect(normalizeQuestions([question])).toEqual([
      { ...question, allow_multiple: false },
    ]);
  });

  it("rejects duplicate question and option ids", () => {
    expect(findQuestionError([question, question])).toBe(
      "Duplicate question id: config_areas",
    );
    expect(
      findQuestionError([
        {
          ...question,
          options: [
            { id: "same", label: "First" },
            { id: "same", label: "Second" },
          ],
        },
      ]),
    ).toBe("Duplicate option id 'same' in question 'config_areas'");
  });

  it("treats selected options and custom text as answers", () => {
    expect(hasAnswer(undefined)).toBe(false);
    expect(
      hasAnswer({
        questionId: question.id,
        optionIds: [],
      }),
    ).toBe(false);
    expect(
      hasAnswer({
        questionId: question.id,
        optionIds: ["user_rules"],
      }),
    ).toBe(true);
    expect(
      hasAnswer({
        questionId: question.id,
        optionIds: [],
        customText: "A custom answer",
      }),
    ).toBe(true);
  });

  it("formats selected option ids like Cursor AskQuestion", () => {
    const answers: Answer[] = [
      {
        questionId: "config_areas",
        optionIds: ["skills", "user_rules"],
      },
    ];

    expect(formatAskUserQuestionResult(answers)).toBe(
      "<AskUserQuestionResult>\n" +
        "Question config_areas: Selected option(s) skills, user_rules\n" +
        "</AskUserQuestionResult>",
    );
  });

  it("formats multiple answers as separate question lines", () => {
    expect(
      formatAskUserQuestionResult([
        { questionId: "scope", optionIds: ["frontend"] },
        { questionId: "priority", optionIds: ["quality", "speed"] },
      ]),
    ).toBe(
      "<AskUserQuestionResult>\n" +
        "Question scope: Selected option(s) frontend\n" +
        "Question priority: Selected option(s) quality, speed\n" +
        "</AskUserQuestionResult>",
    );
  });

  it("omits empty answers from the result", () => {
    expect(
      formatAskUserQuestionResult([
        { questionId: "empty", optionIds: [] },
        { questionId: "scope", optionIds: ["frontend"] },
      ]),
    ).toBe(
      "<AskUserQuestionResult>\n" +
        "Question scope: Selected option(s) frontend\n" +
        "</AskUserQuestionResult>",
    );
  });

  it("includes free text from Other without inventing an option id", () => {
    const answers: Answer[] = [
      {
        questionId: "deployment",
        optionIds: ["preview"],
        customText: "A local Docker target",
      },
    ];

    expect(formatAskUserQuestionResult(answers)).toBe(
      "<AskUserQuestionResult>\n" +
        "Question deployment: Selected option(s) preview; Other: A local Docker target\n" +
        "</AskUserQuestionResult>",
    );
  });
});
