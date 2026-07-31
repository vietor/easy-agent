import type { Skill } from "../skills/types.js";
import type { Tool } from "./types.js";

const DESCRIPTION = "Invoke a skill by name. Skills are packaged instructions that extend capabilities. Available skills and their descriptions are listed in the system prompt. When invoked, the skill's instructions are loaded into context — follow them.";

export function createSkillTool(
  resolve: (name: string) => Skill | undefined
): Tool {
  return {
    name: "Skill",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name of the skill to invoke" },
      },
      required: ["name"],
    },
    summaryArg: "name",
    async execute(args, _ctx) {
      const name = (args.name as string || "").trim();
      if (!name) {
        return { content: "Error: skill name is required", isError: true };
      }
      if (!resolve(name)) {
        return { content: `Error: skill "${name}" not found`, isError: true };
      }
      return { content: `Skill "${name}" loaded. Follow its instructions above.` };
    },
  };
}
