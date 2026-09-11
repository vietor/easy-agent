import { z } from "zod";
import type { Skill } from "../skills/types.js";
import { SKILL_TOOL_NAME } from "../util/constants.js";
import type { Tool } from "./types.js";
import { toToolParameters, toolError, tryParseToolArgs } from "./types.js";

const DESCRIPTION = "Invoke a skill by name. Skills are packaged instructions that extend capabilities. Available skills and their descriptions are listed in the system prompt. When invoked, the skill's instructions are loaded into context — follow them.";

const NAME_ERROR = "skill name is required";

const SkillArgs = z.object({
  name: z.string({ error: NAME_ERROR }).trim().min(1, { error: NAME_ERROR }).describe("The name of the skill to invoke"),
});

export function createSkillTool(
  resolve: (name: string) => Skill | undefined
): Tool {
  return {
    name: SKILL_TOOL_NAME,
    description: DESCRIPTION,
    parameters: toToolParameters(SkillArgs),
    argSummaryKeys: ["name"],
    async execute(args, _ctx) {
      const parsed = tryParseToolArgs(SkillArgs, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { name } = parsed.value;
      if (!resolve(name)) {
        return toolError(`skill "${name}" not found`);
      }
      return { content: `Skill "${name}" loaded. Its instructions are now in the conversation — follow them.` };
    },
    summarizeResult(result) {
      return result.isError ? "Skill failed" : "Successfully loaded skill";
    }
  };
}
