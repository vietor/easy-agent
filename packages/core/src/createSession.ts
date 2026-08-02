import { randomUUID } from "node:crypto";
import { createLLM } from "./llm/client.js";
import { compactThresholdFor } from "./llm/types.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools, type BuiltinToolsOptions } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import { TOOL_USE_PROMPT } from "./tools/prompt.js";
import type { Skill } from "./skills/types.js";
import type { SessionOptions } from "./core/types.js";

export const SYSTEM_PROMPT_BOUNDARY = '\n\n---\n<!-- SYSTEM_PROMPT_BOUNDARY -->\n\n';

const TODO_WRITE_GUIDANCE = "- For multi-step tasks (3+ steps), you MUST use TodoWrite: create the task list first, then update each task's status as you execute. Never execute a multi-step task without a TodoWrite task list.";

const ASK_USER_GUIDANCE = "- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous. When you have enough information to proceed, act without asking.";

const SUBAGENT_GUIDANCE = '- For investigation or planning subtasks, consider delegating to a sub-agent via the SubAgent tool (type: "explore" to investigate the codebase or web, type: "plan" to produce an implementation plan) and continue the work yourself based on its report. Sub-agents are read-only and cannot write or edit files; perform any edits yourself.';

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

export async function createSession(opts: SessionOptions): Promise<Session> {
  const llm = createLLM(opts.llmConfig);
  const tools = new ToolRegistry();
  if (opts.builtinTools !== false) {
    registerBuiltinTools(tools, opts.builtinTools || undefined);
  }
  if (opts.tools) {
    tools.registerAll(opts.tools);
  }
  const mcp = new MCPServers(tools, opts.clientInfo ?? { name: "easy-agent-core", version: "0.0.0" });

  const session = new Session({
    ...opts,
    systemPrompt: buildSystemPrompt(opts.systemPrompt, opts.skills, opts.builtinTools),
    cwd: opts.cwd ?? process.cwd(),
    sessionId: opts.sessionId ?? randomUUID(),
    llm,
    tools,
    mcp,
    compactThreshold: compactThresholdFor(llm.contextWindow),
  });

  if (opts.mcpServers) {
    await session.connectMCP(opts.mcpServers);
  }

  return session;
}
