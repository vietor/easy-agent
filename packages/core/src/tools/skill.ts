import type { Skill } from "../skills/types.js";
import { toolError, type Tool } from "./types.js";

const DESCRIPTION = "Invoke a skill by name. Skills are packaged instructions that extend capabilities. Available skills and their descriptions are listed in the system prompt. When invoked, the skill's instructions are loaded into context — follow them.";

export const SKILL_TOOL_NAME = "Skill" as const;

export function createSkillTool(
  resolve: (name: string) => Skill | undefined
): Tool {
  return {
    name: SKILL_TOOL_NAME,
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
        return toolError("skill name is required");
      }
      if (!resolve(name)) {
        return toolError(`skill "${name}" not found`);
      }
      return { content: `Skill "${name}" loaded. Follow its instructions above.` };
    },
    getPreview(_result) {
      return "Successfully loaded skill";
    }
  };
}
