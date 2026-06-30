#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { LLMClient } from "./llm/client.js";
import { Session } from "./core/session.js";
import { Agent } from "./core/agent.js";
import { ToolRegistry } from "./tools/registry.js";
import { shellTool } from "./tools/builtin/shell.js";
import { fileReadTool } from "./tools/builtin/file_read.js";
import { fileWriteTool } from "./tools/builtin/file_write.js";
import { fileEditTool } from "./tools/builtin/file_edit.js";
import { globTool } from "./tools/builtin/glob.js";
import { grepTool } from "./tools/builtin/grep.js";
import { webFetchTool } from "./tools/builtin/web_fetch.js";
import { MCPServers } from "./mcp/server.js";
import { startApp } from "./tui/App.js";
import { readFirstExistingFileContent } from "./util/fs.js";

const SYSTEM_PROMPT_BASE = `You are Easy Agent, an autonomous coding assistant running in the terminal. You complete tasks by calling tools, inspecting their results, and iterating until the work is done.

Environment:
- Platform: ${process.platform}
- Working directory: ${process.cwd()}

Tool use:
- Prefer dedicated tools (FileRead, FileEdit, Glob, Grep) over the Shell tool when they fit the task.
- Read a file before editing it; make minimal, surgical changes that match the surrounding code style.
- Reference code as file_path:line_number.

Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete. Report outcomes faithfully, and do not narrate alternatives you will not pursue.`;

async function main(): Promise<void> {
  const config = loadConfig();
  const llm = new LLMClient(config.llm);
  const tools = new ToolRegistry();
  for (const t of [shellTool, fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool, webFetchTool])
    tools.register(t);

  const mcp = new MCPServers();
  mcp
    .connect(config.mcpServers)
    .then((list) => {
      for (const t of list) tools.register(t);
    })
    .catch((e) => mcp.report(`MCP connect failed: ${(e as Error).message}`));

  const globalPrompt = readFirstExistingFileContent([
    join(homedir(), ".agents", "AGENTS.md"),
    join(homedir(), ".claude", "CLAUDE.md"),
  ]);
  const projectPrompt = readFirstExistingFileContent([
    join(process.cwd(), "AGENTS.md"),
    join(process.cwd(), "CLAUDE.md"),
  ]);

  const systemPromptParts = [SYSTEM_PROMPT_BASE];
  if (globalPrompt) {
    systemPromptParts.push(globalPrompt);
  }
  if (projectPrompt) {
    systemPromptParts.push(projectPrompt);
  }
  const systemPrompt = systemPromptParts.join("\n\n=================\n\n");

  const session = new Session(systemPrompt);
  const agent = new Agent(llm, session, tools);

  const app = startApp(agent, mcp);
  await app.waitUntilExit().finally(() => mcp.kill());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
