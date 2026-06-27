#!/usr/bin/env node
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
import { startApp } from "./ui/App.js";

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
  for (const t of [
    shellTool,
    fileReadTool,
    fileWriteTool,
    fileEditTool,
    globTool,
    grepTool,
    webFetchTool,
  ])
    tools.register(t);

  const mcp = new MCPServers();
  process.on("exit", () => mcp.kill());
  mcp.connect(config.mcpServers)
    .then((list) => {
      for (const t of list) tools.register(t);
    })
    .catch((e) => mcp.report(`MCP connect failed: ${(e as Error).message}`));

  const session = new Session(SYSTEM_PROMPT_BASE);
  const agent = new Agent(llm, session, tools);

  startApp(agent, mcp);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
