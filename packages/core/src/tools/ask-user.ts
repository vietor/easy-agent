import type { Tool } from "./types.js";
import { toolError } from "../util/types.js";

export const ASK_USER_GUIDANCE = "- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous. When you have enough information to proceed, act without asking.";

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
        return toolError("options must contain at least one choice");
      }
      return ask(question, options);
    },
    summaryArgs: ["question"],
  };
}
