import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import {
  tryLoadSkills,
  tryReadFileText,
  readFirstFileContent,
  startSession,
} from "@vietor/easy-agent-core";
import { builtinCommands } from "./cmds/builtin.js";
import { startApp } from "./tui/App.js";

const SYSTEM_PROMPT_BASE = [
  "You are Easy Agent, an autonomous assistant. You complete tasks by calling tools, inspecting their results, and iterating until the work is done.",
  `Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete; report outcomes faithfully.
- Do not lay out alternative approaches in prose - if a choice is the user's, use AskUser.`,
  `Environment:
- Platform: ${process.platform}
- Working directory: ${process.cwd()}`,
  `Tool use:
- Prefer dedicated tools (FileRead, FileWrite, FileEdit, Glob, Grep, WebFetch) over the Shell tool when they fit the task.
- Read a file before editing it; make minimal, surgical changes that match the surrounding code style.
- Reference code as file_path:line_number.
- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous; when you have enough to proceed, act without asking.${process.platform === "linux" ? "\n- For privileged shell commands, use `sudo -n` (non-interactive); if it reports a password is required, do not retry - surface the command for the user to run manually." : ""}`,
  `Multi-step tasks:
- For non-trivial work (3+ steps), call TodoWrite with the full plan up front: one item per step, in order.
- Keep exactly one item in_progress at a time; mark it completed when done and start the next.
- Pass the entire list on every call (it replaces the previous list). Skip TodoWrite for trivial one-step tasks.`,
].join("\n\n");

export async function main(): Promise<void> {
  const config = loadConfig();

  const globalSkills = readFirstFileContent(
    [join(homedir(), ".agents", "skills"), join(homedir(), ".claude", "skills")],
    tryLoadSkills,
  );

  const globalPrompt = readFirstFileContent(
    [join(homedir(), ".agents", "AGENTS.md"), join(homedir(), ".claude", "CLAUDE.md")],
    tryReadFileText,
  );
  const projectPrompt = readFirstFileContent(
    [join(process.cwd(), "AGENTS.md"), join(process.cwd(), "CLAUDE.md")],
    tryReadFileText,
  );

  const systemPrompt = [SYSTEM_PROMPT_BASE, globalPrompt, projectPrompt]
    .filter(Boolean)
    .join("\n\n=================\n\n");

  const session = await startSession({
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
