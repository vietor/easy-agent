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
  }
  parts.push(toolUseLines.join("\n"));
  if (skills?.length) {
    const lines = skills.map((s) => `- \`${s.name}\`: ${s.description || "no description"}`);
    parts.push(["Available skills (call via the Skill tool):", ...lines].join("\n"));
  }
  return parts.join(SYSTEM_PROMPT_BOUNDARY);
}

const TOOL_USE_PROMPT = [
  "Tool-Use Guidelines:",
  "The user's instructions in the preceding sections take precedence over these defaults.",
  "",
  "- When several tool calls have no dependencies on each other's results, emit them together in one turn so they run concurrently; do not batch calls that depend on a prior result or that modify the same file or resource.",
  "- For file operations (read/write/edit/glob/grep) and fetching URLs, use the dedicated tool. Fall back to Shell only when no dedicated tool covers the task and Shell is available. A runtime error does not make Shell the fallback; do not retry that same operation through Shell.",
].join("\n");

const TODO_WRITE_GUIDANCE = "- For multi-step tasks (3+ steps), you MUST use TodoWrite: create the task list first, then update each task's status as you execute. Never execute a multi-step task without a TodoWrite task list.";

const ASK_USER_GUIDANCE = "- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous. When you have enough information to proceed, act without asking.";

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
    compactThreshold: Math.floor(llm.contextWindow * 0.75),
  });

  if (opts.mcpServers) {
    await mcp.connect(opts.mcpServers);
  }

  return session;
}
