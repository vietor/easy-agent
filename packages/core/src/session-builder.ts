import { LLMClient } from "./llm/client.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools, type BuiltinToolsOptions } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import { CommandRegistry } from "./cmds/registry.js";
import type { Tool } from "./tools/types.js";
import type { Command } from "./cmds/types.js";
import type { Skill } from "./skills/types.js";
import type { MCPServerConfig } from "./mcp/types.js";
import type { LLMConfig } from "./llm/types.js";

export interface SessionOptions {
  /** The base system prompt that defines agent behavior. Include tool-use policies here — core does not add any. */
  systemPrompt: string;
  /** LLM endpoint configuration */
  llmConfig: LLMConfig;
  /** Custom tools beyond the built-in set (shell, file read/write/edit, glob, grep, web_fetch) */
  tools?: Tool[];
  /** Custom slash-commands available in the session */
  commands?: Command[];
  /** Skills loaded from SKILL.md files; each is auto-registered as a command */
  skills?: Skill[];
  /** MCP server configurations */
  mcpServers?: Record<string, MCPServerConfig>;
  /**
   * Configure built-in tools.
   * - `undefined` (default) — register all built-in tools (shell, file, glob, grep, web_fetch)
   * - `false` — skip all built-in tool registration
   * - `{ askUser?: true, todoWrite?: true }` — register built-in tools plus the specified optional tools
   */
  builtinTools?: BuiltinToolsOptions | false;
}

export async function startSession(opts: SessionOptions): Promise<Session> {
  const llm = new LLMClient(opts.llmConfig);

  const tools = new ToolRegistry();
  if (opts.builtinTools !== false) {
    registerBuiltinTools(tools, opts.builtinTools || undefined);
  }
  if (opts.tools) {
    for (const t of opts.tools) tools.register(t);
  }

  const mcp = new MCPServers(tools);
  if (opts.mcpServers) {
    await mcp.connect(opts.mcpServers);
  }

  const commands = new CommandRegistry();
  if (opts.skills) {
    for (const skill of opts.skills) {
      commands.register({
        name: skill.name,
        description: skill.description ?? skill.name,
        execute: async (ctx) => {
          await ctx.session.startSkill(skill);
        },
      });
    }
  }
  if (opts.commands) {
    for (const c of opts.commands) commands.register(c);
  }

  return new Session(llm, opts.systemPrompt, tools, commands, mcp);
}
