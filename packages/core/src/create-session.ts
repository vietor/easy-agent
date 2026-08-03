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

const SUB_AGENT_GUIDANCE = '- Consider delegating subtasks to a sub-agent via the SubAgent tool: type: "explore" to investigate the codebase or web, type: "plan" to produce an implementation plan, or type: "generic" to execute a task end-to-end with full tool access (shell, file read/write/edit, search, web fetch). The sub-agent runs silently and returns only its final report — verify important results yourself, especially for "generic" tasks that modify files.';

function buildSystemPrompt(base: string, skills: Skill[] | undefined, builtinTools: BuiltinToolsOptions | false | undefined): string {
  const parts = [base];
  const toolUseLines = [TOOL_USE_PROMPT];
  if (typeof builtinTools === "object") {
    if (builtinTools.todoWrite) toolUseLines.push(TODO_WRITE_GUIDANCE);
    if (builtinTools.askUser) toolUseLines.push(ASK_USER_GUIDANCE);
    if (builtinTools.subAgent) toolUseLines.push(SUB_AGENT_GUIDANCE);
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
