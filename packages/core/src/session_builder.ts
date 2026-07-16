import { LLMClient } from "./llm/client.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools, type BuiltinToolsOptions } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import { CommandRegistry, registerBuiltinCommands } from "./cmds/registry.js";
import type { Tool } from "./tools/types.js";
import type { Command } from "./cmds/types.js";
import type { Skill } from "./skills/types.js";
import type { MCPServerConfig } from "./mcp/types.js";
import type { LLMConfig } from "./llm/types.js";

export interface SessionOptions {
  systemPrompt: string;
  llmConfig: LLMConfig;
  cwd?: string;
  tools?: Tool[];
  commands?: Command[];
  skills?: Skill[];
  mcpServers?: Record<string, MCPServerConfig>;
  builtinTools?: BuiltinToolsOptions | false;
  clientInfo?: { name: string; version: string };
}

export async function createSession(opts: SessionOptions): Promise<Session> {
  const llm = new LLMClient(opts.llmConfig);

  const tools = new ToolRegistry();
  if (opts.builtinTools !== false) {
    registerBuiltinTools(tools, opts.builtinTools || undefined);
  }
  if (opts.tools) {
    for (const t of opts.tools) tools.register(t);
  }

  const mcp = new MCPServers(tools, opts.clientInfo ?? { name: "easy-agent-core", version: "0.0.0" });
  if (opts.mcpServers) {
    await mcp.connect(opts.mcpServers);
  }

  const commands = new CommandRegistry();
  registerBuiltinCommands(commands);

  if (opts.commands) {
    for (const c of opts.commands) commands.register(c);
  }

  return new Session({
    llm,
    systemPrompt: opts.systemPrompt,
    cwd: opts.cwd ?? process.cwd(),
    tools,
    commands,
    mcp,
    skills: opts.skills,
  });
}
