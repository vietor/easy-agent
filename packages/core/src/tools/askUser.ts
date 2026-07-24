import type { Tool } from "./types.js";

const DESCRIPTION = "Ask the user a question. Use when a decision belongs to the user: multiple reasonable approaches, irreversible actions, or ambiguous requests. Returns the answer as text.";

export function createAskUserTool(ask: (question: string, options: string[]) => Promise<string>): Tool {
  return {
    name: "AskUser",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user." },
        options: { type: "array", items: { type: "string" }, description: "Optional list of choices." },
      },
      required: ["question"],
    },
    async execute(args, _ctx) {
      const question = args.question as string;
      const options = Array.isArray(args.options) ? (args.options as string[]) : [];
      return ask(question, options);
    },
    summaryArg: "question",
  };
}
