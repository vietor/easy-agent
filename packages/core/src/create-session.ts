import { contextLimitFor, createLLM } from "./llm/client.js";
import { Session } from "./runtime/session.js";
import { ToolRegistry, type BuiltInToolsOptions } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import { TOOL_USE_PROMPT } from "./runtime/prompts.js";
import { DEFAULT_MAX_TURNS } from "./util/constants.js";
import { TODO_WRITE_GUIDANCE } from "./tools/todo-write.js";
import { ASK_USER_GUIDANCE } from "./tools/ask-user.js";
import { SUB_AGENT_GUIDANCE } from "./tools/sub-agent.js";
import type { Skill } from "./skills/types.js";
import type { SessionOptions } from "./runtime/session.js";

export const SYSTEM_PROMPT_BOUNDARY = '\n\n---\n<!-- SYSTEM_PROMPT_BOUNDARY -->\n\n';

function buildSystemPrompt(base: string, skills: Skill[] | undefined, builtInTools: BuiltInToolsOptions | false | undefined, maxTurns: number): string {
  const parts = [base];
  const toolUseLines = [TOOL_USE_PROMPT, `- Turn budget: ${maxTurns} tool-calling turns per run.`];
  if (typeof builtInTools === "object") {
    if (builtInTools.todoWrite) toolUseLines.push(TODO_WRITE_GUIDANCE);
    if (builtInTools.askUser) toolUseLines.push(ASK_USER_GUIDANCE);
    if (builtInTools.subAgent) toolUseLines.push(SUB_AGENT_GUIDANCE);
  }
  parts.push(toolUseLines.join("\n"));
  if (skills?.length) {
    const lines = skills.map((s) => `- \`${s.name}\`: ${s.description || "no description"}`);
    parts.push(["Available skills (call via the Skill tool):", ...lines].join("\n"));
  }
  return parts.join(SYSTEM_PROMPT_BOUNDARY);
}

export async function createSession(opts: SessionOptions): Promise<Session> {
  const llm = createLLM(opts.llm);
  const tools = new ToolRegistry();
  const mcp = new MCPServers(tools, opts.clientInfo ?? { name: "easy-agent-core", version: "0.0.0" });

  const session = new Session({
    ...opts,
    systemPrompt: buildSystemPrompt(opts.systemPrompt, opts.skills, opts.builtInTools, opts.maxTurns ?? DEFAULT_MAX_TURNS),
    llm,
    tools,
    mcp,
    contextLimit: contextLimitFor(llm.maxInputTokens),
  });

  if (opts.tools) {
    tools.registerAll(opts.tools);
  }

  if (opts.mcp) {
    await session.connectMCP(opts.mcp);
  }

  return session;
}
