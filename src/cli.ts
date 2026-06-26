import { loadConfig } from "./config.js";
import { LLMClient } from "./llm/client.js";
import { Session } from "./core/session.js";
import { Agent } from "./core/agent.js";
import { ToolRegistry } from "./tools/registry.js";
import { bashTool } from "./tools/builtin/bash.js";
import { fileReadTool } from "./tools/builtin/file_read.js";
import { fileWriteTool } from "./tools/builtin/file_write.js";
import { fileEditTool } from "./tools/builtin/file_edit.js";
import { globTool } from "./tools/builtin/glob.js";
import { grepTool } from "./tools/builtin/grep.js";
import { webFetchTool } from "./tools/builtin/web_fetch.js";
import { MCPServers } from "./mcp/server.js";
import { startApp } from "./ui/App.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const llm = new LLMClient(config.llm);
  const tools = new ToolRegistry();
  for (const t of [
    bashTool,
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

  const system = [
    "You are Easy Agent, an autonomous intelligent assistant.",
    `Working platform: ${process.platform}`,
    `Working directory: ${process.cwd()}`,
    "Given the user's message, you should use the tools available to complete the task.",
    "Prefer WebFetch over Bash for retrieving URL content; use Bash only when WebFetch cannot accomplish the task.",
  ].join("\n");

  const session = new Session(system);
  const agent = new Agent(llm, session, tools);

  startApp(agent, mcp);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
