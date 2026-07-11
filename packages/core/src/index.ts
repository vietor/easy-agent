// Public framework surface: customization types + the startSession factory.
// Orchestration (Agent, Conversation, LLMClient, LogStore, MCPServers) stays internal.
export type { Session, SessionCallbacks } from "./core/session.js";
export type { LogEntry } from "./core/logstore.js";
export type { Tool, ToolContext, ToolResult, ToolSchema, Todo, TodoStatus } from "./tools/types.js";
export type { Command, CommandSchema, CommandContext, CommandHost } from "./cmds/types.js";
export type { Skill } from "./skills/types.js";
export type { MCPServerConfig } from "./mcp/types.js";
export type { LLMConfig } from "./llm/types.js";
export { tryLoadSkills } from "./skills/loader.js";
export { tryReadFileText, readFirstFileContent } from "./util/fs.js";
export { getPackageInfo } from "./util/package.js";

import { LLMClient } from "./llm/client.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import { CommandRegistry } from "./cmds/registry.js";
import type { Tool } from "./tools/types.js";
import type { Command } from "./cmds/types.js";
import type { Skill } from "./skills/types.js";
import type { MCPServerConfig } from "./mcp/types.js";
import type { LLMConfig } from "./llm/types.js";

// Tool-usage policy tied to the built-in tools. Core owns this so the tool
// priority (prefer dedicated tools over Shell, read-before-edit, AskUser
// timing, TodoWrite discipline) ships with the tools themselves.
const BUILTIN_TOOLS_POLICY = [
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
      ? [
          "- For privileged shell commands, use `sudo -n` (non-interactive); if it reports a password is required, do not retry - surface the command for the user to run manually.",
        ]
      : []),
  ].join("\n"),
  [
    "Multi-step tasks:",
    "- For non-trivial work (3+ steps), call TodoWrite with the full plan up front: one item per step, in order.",
    "- Keep exactly one item in_progress at a time; mark it completed when done and start the next.",
    "- Pass the entire list on every call (it replaces the previous list). Skip TodoWrite for trivial one-step tasks.",
  ].join("\n"),
].join("\n\n");

export interface SessionOptions {
  systemPrompt: string;
  llmConfig: LLMConfig;
  tools?: Tool[];
  commands?: Command[];
  skills?: Skill[];
  mcpServers?: Record<string, MCPServerConfig>;
}

export async function startSession(opts: SessionOptions): Promise<Session> {
  const llm = new LLMClient(opts.llmConfig);

  const tools = new ToolRegistry();
  registerBuiltinTools(tools);
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
        execute: async (_, host) => {
          await host.runSkill(skill);
        },
      });
    }
  }
  if (opts.commands) {
    for (const c of opts.commands) commands.register(c);
  }

  const systemPrompt = [opts.systemPrompt, BUILTIN_TOOLS_POLICY].filter(Boolean).join("\n\n=================\n\n");

  return new Session(llm, systemPrompt, tools, commands, mcp);
}
