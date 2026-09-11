import { z } from "zod";
import { ASK_USER_TOOL_NAME } from "../util/constants.js";
import type { Tool } from "./types.js";
import { toToolParameters, toolError, tryParseToolArgs } from "./types.js";

export const ASK_USER_GUIDANCE = "- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous. When you have enough information to proceed, act without asking. Batch related questions into a single AskUser call.";

export interface AskOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  header?: string;
  question: string;
  options: AskOption[];
  multiSelect: boolean;
}

export type AskAnswer = string | string[];

export type AskedQuestion = AskQuestion & { answer: AskAnswer | null };

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MAX_HEADER_LENGTH = 12;

const DESCRIPTION = "Ask the user 1-4 questions and wait for the answers. Each question has an optional header (at most 12 chars), 2-4 options with optional descriptions, and an optional multiSelect flag. Returns JSON keyed by question text; multi-select answers are arrays of selected labels; skipped questions return an empty string. Do not add an 'Other' option — the user can always type a custom answer.";

const QUESTIONS_ERROR = `"questions" must be an array of 1-${MAX_QUESTIONS} question objects`;
const QUESTION_ERROR = "each question needs non-empty text";
const OPTIONS_ERROR = `each question needs 2-${MAX_OPTIONS} options`;
const LABEL_ERROR = "each option needs a non-empty label";

const AskOptionSchema = z.object({
  label: z.string({ error: LABEL_ERROR }).trim().min(1, { error: LABEL_ERROR }).describe("The choice label."),
  description: z.string().optional().describe("Optional detail shown under the label."),
});

const AskQuestionSchema = z.object({
  header: z.string().overwrite((header) => header.slice(0, MAX_HEADER_LENGTH)).max(MAX_HEADER_LENGTH).optional()
    .describe("Short label for the question, shown as a chip."),
  question: z.string({ error: QUESTION_ERROR }).trim().min(1, { error: QUESTION_ERROR }).describe("The question text."),
  options: z.array(AskOptionSchema, { error: OPTIONS_ERROR }).min(2, { error: OPTIONS_ERROR }).max(MAX_OPTIONS, { error: OPTIONS_ERROR })
    .describe("2-4 mutually exclusive choices."),
  multiSelect: z.boolean({ error: "multiSelect must be a boolean" }).default(false)
    .describe("Whether the user may pick more than one option."),
});

const AskUserArgs = z.object({
  questions: z.array(AskQuestionSchema, { error: QUESTIONS_ERROR }).min(1, { error: QUESTIONS_ERROR }).max(MAX_QUESTIONS, { error: QUESTIONS_ERROR })
    .describe("1-4 questions to ask the user, answered together."),
});

export function parseQuestions(args: Record<string, unknown>): { questions: AskQuestion[]; error?: string } {
  const parsed = tryParseToolArgs(AskUserArgs, args);
  if (!parsed.ok) return { questions: [], error: parsed.error };
  const questions: AskQuestion[] = [];
  const seen = new Set<string>();
  for (const q of parsed.value.questions) {
    if (seen.has(q.question)) return { questions: [], error: "questions must be unique" };
    seen.add(q.question);
    questions.push({
      header: q.header || undefined,
      question: q.question,
      options: q.options.map((o) => ({ label: o.label, description: o.description || undefined })),
      multiSelect: q.multiSelect,
    });
  }
  return { questions };
}

export function createAskUserTool(ask: (questions: AskQuestion[]) => Promise<AskAnswer[]>): Tool {
  return {
    name: ASK_USER_TOOL_NAME,
    description: DESCRIPTION,
    parameters: toToolParameters(AskUserArgs),
    summarizeArgs(args) {
      const { questions, error } = parseQuestions(args);
      if (error) return "invalid";
      return `${questions.length} question${questions.length === 1 ? "" : "s"}`;
    },
    async execute(args, _ctx) {
      const { questions, error } = parseQuestions(args);
      if (error) return toolError(error);
      const answers = await ask(questions);
      const result: Record<string, AskAnswer> = {};
      questions.forEach((q, i) => {
        result[q.question] = answers[i] ?? "";
      });
      return { content: JSON.stringify(result) };
    },
  };
}
