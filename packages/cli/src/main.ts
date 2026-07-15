import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import {
  tryLoadSkills,
  tryReadFileText,
  createSession,
} from "@vietor/easy-agent-core";
import { builtinCommands } from "./cmds/builtin.js";
import { startApp } from "./tui/App.js";

const SYSTEM_PROMPT_BASE = [
  "You are Easy Agent, an autonomous assistant. You complete tasks by calling tools, inspecting their results, and iterating until the work is done.",
  `Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete; report outcomes faithfully.
- Reference code as file_path:line_number.`,
  `Environment:
- Platform: ${process.platform}
- Working directory: ${process.cwd()}`,
  `Decision making:
- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous; when you have enough to proceed, act without asking.`,
].join("\n\n");

export async function main(): Promise<void> {
  const config = loadConfig();

  const globalSkills = tryLoadSkills(join(homedir(), ".agents", "skills"))
    ?? tryLoadSkills(join(homedir(), ".claude", "skills"));

  const globalPrompt = tryReadFileText(join(homedir(), ".agents", "AGENTS.md"))
    ?? tryReadFileText(join(homedir(), ".claude", "CLAUDE.md"));
  const projectPrompt = tryReadFileText(join(process.cwd(), "AGENTS.md"))
    ?? tryReadFileText(join(process.cwd(), "CLAUDE.md"));

  const systemPrompt = [SYSTEM_PROMPT_BASE, globalPrompt, projectPrompt]
    .filter(Boolean)
    .join("\n\n=================\n\n");

  const session = await createSession({
    systemPrompt,
    llmConfig: config.llm,
    mcpServers: config.mcpServers,
    skills: globalSkills,
    commands: builtinCommands,
    builtinTools: {
      askUser: true,
      todoWrite: true
    }
  });

  const app = startApp(session);
  await app.waitUntilExit().finally(() => session.dispose());
}
