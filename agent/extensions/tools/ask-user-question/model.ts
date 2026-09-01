import { type Static, Type } from "typebox";

const QuestionOptionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this option" }),
  label: Type.String({ description: "Display text for this option" }),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  prompt: Type.String({
    description:
      "The question text to display to the user, without the options.",
  }),
  allow_multiple: Type.Optional(
    Type.Boolean({
      description:
        "If true, the user can select multiple options. Defaults to false.",
    }),
  ),
  options: Type.Array(QuestionOptionSchema, {
    description: "Array of answer options (minimum 2 required)",
    minItems: 2,
  }),
});

export const AskUserQuestionParamsSchema = Type.Object({
  title: Type.Optional(
    Type.String({ description: "Optional title for the questions form" }),
  ),
  questions: Type.Array(QuestionSchema, {
    description:
      "Array of questions to present to the user (minimum 1 required)",
    minItems: 1,
  }),
});

export type QuestionOption = Static<typeof QuestionOptionSchema>;
export type Question = Static<typeof QuestionSchema>;
export type NormalizedQuestion = Omit<Question, "allow_multiple"> & {
  allow_multiple: boolean;
};

export interface Answer {
  questionId: string;
  optionIds: string[];
  customText?: string;
}

export interface AskUserQuestionResult {
  questions: NormalizedQuestion[];
  answers: Answer[];
  cancelled: boolean;
}

export function normalizeQuestions(
  questions: Question[],
): NormalizedQuestion[] {
  return questions.map((question) => ({
    ...question,
    allow_multiple: question.allow_multiple ?? false,
  }));
}

export function findQuestionError(questions: Question[]): string | undefined {
  const questionIds = new Set<string>();

  for (const question of questions) {
    if (questionIds.has(question.id)) {
      return `Duplicate question id: ${question.id}`;
    }
    questionIds.add(question.id);

    const optionIds = new Set<string>();
    for (const option of question.options) {
      if (optionIds.has(option.id)) {
        return `Duplicate option id '${option.id}' in question '${question.id}'`;
      }
      optionIds.add(option.id);
    }
  }

  return undefined;
}

export function hasAnswer(answer: Answer | undefined): boolean {
  return Boolean(
    answer && (answer.optionIds.length > 0 || answer.customText !== undefined),
  );
}

export function formatAskUserQuestionResult(answers: Answer[]): string {
  const lines = answers.filter(hasAnswer).map((answer) => {
    const parts: string[] = [];
    if (answer.optionIds.length > 0) {
      parts.push(`Selected option(s) ${answer.optionIds.join(", ")}`);
    }
    if (answer.customText !== undefined) {
      parts.push(`Other: ${answer.customText}`);
    }
    return `Question ${answer.questionId}: ${parts.join("; ")}`;
  });

  return `<AskUserQuestionResult>\n${lines.join("\n")}\n</AskUserQuestionResult>`;
}
