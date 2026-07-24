import { createLLM } from "./llm/client.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools, type BuiltinToolsOptions } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import { CommandRegistry, registerBuiltinCommands } from "./cmds/registry.js";
import type { Tool } from "./tools/types.js";
import type { Command } from "./cmds/types.js";
import type { Skill } from "./skills/types.js";
import type { MCPServerConfig } from "./mcp/types.js";
import type { LLMConfig } from "./llm/types.js";
import type { SessionPersistence } from "./core/types.js";

export const SYSTEM_PROMPT_BOUNDARY = '\n\n---\n<!-- SYSTEM_PROMPT_BOUNDARY --> \n\n';

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
  sessionId?: string;
  persistence?: SessionPersistence;
  compactThreshold?: number;
  maxTurns?: number;
  stallThreshold?: number;
}

const TOOL_USE_PROMPT = [
  "Tool-Use Guidelines:",
  "The user's instructions in the preceding sections take precedence over these defaults.",
  "",
  "- When several tool calls have no dependencies on each other's results, emit them together in one turn so they run concurrently.",
  "- Do not batch calls that depend on a prior result or that modify the same file or resource.",
  "- For file operations (read/write/edit/glob/grep) and fetching URLs, prefer the dedicated tool over Shell.",
].join("\n");

export async function createSession(opts: SessionOptions): Promise<Session> {
  const llm = createLLM(opts.llmConfig);

  const tools = new ToolRegistry();
  if (opts.builtinTools !== false) {
    registerBuiltinTools(tools, opts.builtinTools || undefined);
  }
  if (opts.tools) {
    tools.registerAll(opts.tools);
  }

  const commands = new CommandRegistry();
  registerBuiltinCommands(commands);
  if (opts.commands) {
    for (const c of opts.commands) commands.register(c);
  }

  const mcp = new MCPServers(tools, opts.clientInfo ?? { name: "easy-agent-core", version: "0.0.0" });

  const session = new Session({
    llm,
    systemPrompt: opts.systemPrompt + SYSTEM_PROMPT_BOUNDARY + TOOL_USE_PROMPT,
    cwd: opts.cwd ?? process.cwd(),
    tools,
    commands,
    mcp,
    skills: opts.skills,
    builtinTools: opts.builtinTools === false ? undefined : opts.builtinTools,
    sessionId: opts.sessionId,
    persistence: opts.persistence,
    compactThreshold: opts.compactThreshold,
    maxTurns: opts.maxTurns,
    stallThreshold: opts.stallThreshold,
  });

  if (opts.mcpServers) {
    await mcp.connect(opts.mcpServers);
  }

  return session;
}
