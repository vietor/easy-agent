import { createLLM } from "./llm/client.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools, type BuiltinToolsOptions } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import { TOOL_USE_PROMPT } from "./tools/prompt.js";
import { CommandRegistry, registerBuiltinCommands } from "./cmds/registry.js";
import type { Tool } from "./tools/types.js";
import type { Command } from "./cmds/types.js";
import type { Skill } from "./skills/types.js";
import type { MCPServerConfig } from "./mcp/types.js";
import { compactThresholdFor, type LLMConfig } from "./llm/types.js";
import type { SessionPersistence } from "./core/types.js";

export const SYSTEM_PROMPT_BOUNDARY = '\n\n---\n<!-- SYSTEM_PROMPT_BOUNDARY -->\n\n';

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
  maxTurns?: number;
  stallThreshold?: number;
}

function buildSystemPrompt(base: string, skills: Skill[] | undefined, builtinTools: BuiltinToolsOptions | false | undefined): string {
  const parts = [base];
  const toolUseLines = [TOOL_USE_PROMPT];
  if (typeof builtinTools === "object") {
    if (builtinTools.todoWrite) toolUseLines.push(TODO_WRITE_GUIDANCE);
    if (builtinTools.askUser) toolUseLines.push(ASK_USER_GUIDANCE);
    if (builtinTools.subAgent) toolUseLines.push(SUBAGENT_GUIDANCE);
  }
  parts.push(toolUseLines.join("\n"));
  if (skills?.length) {
    const lines = skills.map((s) => `- \`${s.name}\`: ${s.description || "no description"}`);
    parts.push(["Available skills (call via the Skill tool):", ...lines].join("\n"));
  }
  return parts.join(SYSTEM_PROMPT_BOUNDARY);
}

const TODO_WRITE_GUIDANCE = "- For multi-step tasks (3+ steps), you MUST use TodoWrite: create the task list first, then update each task's status as you execute. Never execute a multi-step task without a TodoWrite task list.";

const ASK_USER_GUIDANCE = "- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous. When you have enough information to proceed, act without asking.";

const SUBAGENT_GUIDANCE = '- For investigation or planning subtasks, consider delegating to a sub-agent via the SubAgent tool (type: "explore" to investigate the codebase or web, type: "plan" to produce an implementation plan) and continue the work yourself based on its report. Sub-agents are read-only and cannot write or edit files; perform any edits yourself.';

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
    systemPrompt: buildSystemPrompt(opts.systemPrompt, opts.skills, opts.builtinTools),
    cwd: opts.cwd ?? process.cwd(),
    tools,
    commands,
    mcp,
    skills: opts.skills,
    builtinTools: opts.builtinTools === false ? undefined : opts.builtinTools,
    sessionId: opts.sessionId,
    persistence: opts.persistence,
    stallThreshold: opts.stallThreshold ?? 3,
    maxTurns: opts.maxTurns ?? 50,
    compactThreshold: compactThresholdFor(llm.contextWindow),
  });

  if (opts.mcpServers) {
    await mcp.connect(opts.mcpServers);
  }

  return session;
}
