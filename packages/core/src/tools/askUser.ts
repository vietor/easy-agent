import type { Tool } from "./types.js";

const DESCRIPTION = "Ask the user a question and wait for the answer. Provide at least one option. Returns the answer as text.";

export function createAskUserTool(ask: (question: string, options: string[]) => Promise<string>): Tool {
  return {
    name: "AskUser",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user." },
        options: { type: "array", items: { type: "string" }, minItems: 1, description: "List of choices; at least one required." },
      },
      required: ["question", "options"],
    },
    async execute(args, _ctx) {
      const question = args.question as string;
      const options = Array.isArray(args.options) ? (args.options as string[]) : [];
      if (!options.length) {
        return { content: "Error: options must contain at least one choice", isError: true };
      }
      return ask(question, options);
    },
    summaryArg: "question",
  };
}
