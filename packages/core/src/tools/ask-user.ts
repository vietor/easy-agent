import type { Tool } from "./types.js";
import { toolError } from "./types.js";

export const ASK_USER_GUIDANCE = "- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous. When you have enough information to proceed, act without asking. Batch related questions into a single AskUser call (up to 4 questions, 2-4 options each).";

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

function parseQuestions(args: Record<string, unknown>): { questions: AskQuestion[]; error?: string } {
  const raw = args.questions;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { questions: [], error: `"questions" must be an array of 1-${MAX_QUESTIONS} question objects, got ${typeof raw}` };
  }
  if (raw.length > MAX_QUESTIONS) {
    return { questions: [], error: `"questions" must contain at most ${MAX_QUESTIONS} questions, got ${raw.length}` };
  }
  const questions: AskQuestion[] = [];
  const seen = new Set<string>();
  for (const q of raw as Partial<AskQuestion>[]) {
    if (!q) return { questions: [], error: "each question must be an object" };
    const question = typeof q.question === "string" ? q.question.trim() : "";
    if (!question) return { questions: [], error: "each question needs non-empty text" };
    if (seen.has(question)) return { questions: [], error: "questions must be unique" };
    seen.add(question);
    const options: AskOption[] = [];
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > MAX_OPTIONS) {
      return { questions: [], error: `each question needs 2-${MAX_OPTIONS} options` };
    }
    for (const o of q.options as Partial<AskOption>[]) {
      if (!o) return { questions: [], error: "each option must be an object" };
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (!label) return { questions: [], error: "each option needs a non-empty label" };
      options.push({ label, description: typeof o.description === "string" && o.description ? o.description : undefined });
    }
    const header = typeof q.header === "string" && q.header ? q.header.slice(0, MAX_HEADER_LENGTH) : undefined;
    questions.push({ header, question, options, multiSelect: q.multiSelect === true });
  }
  return { questions };
}

export function createAskUserTool(ask: (questions: AskQuestion[]) => Promise<AskAnswer[]>): Tool {
  return {
    name: "AskUser",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "1-4 questions to ask the user, answered together.",
          minItems: 1,
          maxItems: MAX_QUESTIONS,
          items: {
            type: "object",
            properties: {
              header: { type: "string", maxLength: MAX_HEADER_LENGTH, description: "Short label for the question, shown as a chip." },
              question: { type: "string", description: "The question text." },
              options: {
                type: "array",
                minItems: 2,
                maxItems: MAX_OPTIONS,
                description: "2-4 mutually exclusive choices.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "The choice label." },
                    description: { type: "string", description: "Optional detail shown under the label." },
                  },
                  required: ["label"],
                },
              },
              multiSelect: { type: "boolean", description: "Whether the user may pick more than one option." },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
    },
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
