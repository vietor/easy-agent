import { homedir } from "node:os";
import { join } from "node:path";
import { SYSTEM_PROMPT_BOUNDARY } from "@vietor/agent-core";
import { tryReadFileText } from "@vietor/agent-core/util";

export function buildSystemPromptBase(cwd: string) {
  return [
    "You are Easy Agent, an autonomous assistant. You complete tasks by calling tools, inspecting their results, and iterating until the work is done.",
    `Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete; report outcomes faithfully.
- Reference code as file_path:line_number.`,
    `Environment:
- Platform: ${process.platform}
- Working directory: ${cwd}`,
    `Working style:
- Read relevant code/config before acting; do not guess implementation details or restate files from memory.
- Make surgical changes and match existing style; do not refactor unrelated code.
- Trust tool results as ground truth.`,
  ].join("\n\n");
}

export function assembleSystemPrompt(cwd: string): string {
  const globalPrompt =
    tryReadFileText(join(homedir(), ".easy-agent", "AGENTS.md")) ??
    tryReadFileText(join(homedir(), ".claude", "CLAUDE.md"));
  const projectPrompt = tryReadFileText(join(cwd, "AGENTS.md")) ?? tryReadFileText(join(cwd, "CLAUDE.md"));
  return [buildSystemPromptBase(cwd), globalPrompt, projectPrompt]
    .filter(Boolean)
    .join(SYSTEM_PROMPT_BOUNDARY);
}
