import { loadConfig } from "./config.js";
import { LLMClient } from "./llm/client.js";
import { Session } from "./core/session.js";
import { Agent } from "./core/agent.js";
import { ToolRegistry } from "./tools/registry.js";
import { bashTool } from "./tools/builtin/bash.js";
import { readTool } from "./tools/builtin/read.js";
import { writeTool } from "./tools/builtin/write.js";
import { editTool } from "./tools/builtin/edit.js";
import { globTool } from "./tools/builtin/glob.js";
import { grepTool } from "./tools/builtin/grep.js";
import { startApp } from "./ui/App.js";

function main(): void {
  const config = loadConfig();
  const llm = new LLMClient(config);
  const tools = new ToolRegistry();
  for (const t of [bashTool, readTool, writeTool, editTool, globTool, grepTool]) tools.register(t);

  const system =
    `You are easy-agent, an autonomous coding assistant.\n` +
    `Working directory: ${process.cwd()}\n` +
    `Use the provided tools to inspect and modify files and run commands.\n` +
    `Be concise. Prefer tools over asking the user when a task is actionable.`;

  const session = new Session(system);
  const agent = new Agent(llm, session, tools);

  startApp(agent);
}

main();
