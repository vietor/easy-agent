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
    "- Prefer dedicated tools (FileRead, FileEdit, Glob, Grep) over the Shell tool when they fit the task.",
    "- Read a file before editing it; make minimal, surgical changes that match the surrounding code style.",
    "- Reference code as file_path:line_number.",
    ...(process.platform === "linux"
      ? ["- For privileged shell commands, use `sudo -n` (non-interactive); if it reports a password is required, do not retry - surface the command for the user to run manually."]
      : []),
  ].join("\n"),
  `Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete. Report outcomes faithfully, and do not narrate alternatives you will not pursue.`,
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
