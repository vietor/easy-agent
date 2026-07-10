import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { LLMClient } from "./llm/client.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools } from "./tools/registry.js";
import { CommandRegistry, registerBuiltinCommands } from "./cmds/registry.js";
import { tryLoadSkills } from "./skills/loader.js";
import { tryReadFileText, readFirstFileContent } from "./util/fs.js";
import { MCPServers } from "./mcp/server.js";
import { startApp } from "./tui/App.js";

const SYSTEM_PROMPT_BASE = [
  "You are Easy Agent, an autonomous coding assistant running in the terminal. You complete tasks by calling tools, inspecting their results, and iterating until the work is done.",
  `Environment:
- Platform: ${process.platform}
- Working directory: ${process.cwd()}`,
  [
    "Tool use:",
    "- Prefer dedicated tools (FileRead, FileWrite, FileEdit, Glob, Grep, WebFetch) over the Shell tool when they fit the task.",
    "- Read a file before editing it; make minimal, surgical changes that match the surrounding code style.",
    "- Reference code as file_path:line_number.",
    "- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous; when you have enough to proceed, act without asking.",
    ...(process.platform === "linux"
      ? ["- For privileged shell commands, use `sudo -n` (non-interactive); if it reports a password is required, do not retry - surface the command for the user to run manually."]
      : []),
  ].join("\n"),
  `Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete; report outcomes faithfully.
- Do not lay out alternative approaches in prose - if a choice is the user's, use AskUser.`,
  [
    "Multi-step tasks:",
    "- For non-trivial work (3+ steps), call TodoWrite with the full plan up front: one item per step, in order.",
    "- Keep exactly one item in_progress at a time; mark it completed when done and start the next.",
    "- Pass the entire list on every call (it replaces the previous list). Skip TodoWrite for trivial one-step tasks.",
  ].join("\n"),
].join("\n\n");

export async function main(): Promise<void> {
  const config = loadConfig();
  const llm = new LLMClient(config.llm);

  const tools = new ToolRegistry();
  registerBuiltinTools(tools);

  const commands = new CommandRegistry();
  registerBuiltinCommands(commands);

  const mcp = new MCPServers(tools);
  mcp
    .connect(config.mcpServers)
    .catch((e) => mcp.report(`MCP connect failed: ${(e as Error).message}`));

  const globalSkills = readFirstFileContent(
    [join(homedir(), ".agents", "skills"), join(homedir(), ".claude", "skills")],
    tryLoadSkills,
  );
  if (globalSkills) {
    globalSkills.forEach((skill) =>
      commands.register({
        name: skill.name,
        description: skill.description ?? skill.name,
        execute: async (_, host) => {
          await host.runSkill(skill);
        },
      }),
    );
  }

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

  const session = new Session(llm, systemPrompt, tools, commands, mcp);

  const app = startApp(session);
  await app.waitUntilExit().finally(() => session.dispose());
}
