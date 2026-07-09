import type { Tool } from "./types.js";

const DESCRIPTION = [
  "Ask the user a question and wait for their answer.",
  "Use when a decision belongs to the user: multiple reasonable approaches, an irreversible or consequential action, or an ambiguous request. Present choices via options rather than prose.",
  "options is an optional list of choices; the user may also type a custom answer.",
  "Returns the user's answer as text; an empty string means the user skipped the question.",
].join(" ");

export const askUserTool: Tool = {
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
  async execute(args, ctx) {
    const question = args.question as string;
    const options = Array.isArray(args.options) ? (args.options as string[]) : [];
    return ctx.ask(question, options);
  },
  summaryArg: "question",
};
