import { randomUUID } from "node:crypto";
import { createLLM } from "./llm/client.js";
import { Session } from "./runtime/session.js";
import { sessionFileName } from "./runtime/session-persistence.js";
import { ToolRegistry, type BuiltinToolsOptions } from "./tools/registry.js";
import { MCPServerManager } from "./mcp/manager.js";
import { renderToolUsePrompt, TOOL_OUTPUT_GUIDANCE } from "./runtime/prompts.js";
import { CONTEXT_LIMIT_RATIO, DEFAULT_MAX_PARALLEL_TOOL_CALLS, DEFAULT_MAX_TURNS } from "./util/constants.js";
import { notesFileName, notesFilePath } from "./util/file.js";
import { cleanupSpoolDir } from "./util/spool.js";
import { TODO_WRITE_GUIDANCE } from "./tools/todo-write.js";
import { ASK_USER_GUIDANCE } from "./tools/ask-user.js";
import { renderSubAgentGuidance } from "./tools/sub-agent.js";
import type { Skill } from "./skills/types.js";
import type { SessionOptions } from "./runtime/session.js";

export const SYSTEM_PROMPT_BOUNDARY = '\n\n---\n<!-- SYSTEM_PROMPT_BOUNDARY -->\n\n';

function contextLimitFor(maxInputTokens: number, maxOutputTokens: number): number {
  return Math.floor(Math.min(maxInputTokens * CONTEXT_LIMIT_RATIO, maxInputTokens - maxOutputTokens));
}

function buildSystemPrompt(base: string, skills: Skill[] | undefined, builtInTools: BuiltinToolsOptions | false | undefined, maxTurns: number, maxParallelToolCalls: number, toolSpoolDir: string | undefined, sessionId: string): string {
  const parts = [base];
  const mode = builtInTools === false ? "none" : builtInTools?.readOnly === true ? "readOnly" : "full";
  const toolUseLines = [renderToolUsePrompt(maxTurns, mode, toolSpoolDir ? notesFilePath(toolSpoolDir, sessionId) : undefined)];
  if (toolSpoolDir) toolUseLines.push(TOOL_OUTPUT_GUIDANCE);
  if (typeof builtInTools === "object") {
    if (builtInTools.todoWrite) toolUseLines.push(TODO_WRITE_GUIDANCE);
    if (builtInTools.askUser) toolUseLines.push(ASK_USER_GUIDANCE);
    if (builtInTools.subAgent) toolUseLines.push(renderSubAgentGuidance(builtInTools.readOnly === true, maxParallelToolCalls, maxTurns));
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
  const mcp = new MCPServerManager(tools, opts.clientInfo ?? { name: "agent-core", version: "0.0.0" });
  const sessionId = opts.sessionId ?? randomUUID();
  if (opts.sessionDir) await cleanupSpoolDir(opts.sessionDir, sessionFileName(sessionId));
  if (opts.toolSpoolDir) await cleanupSpoolDir(opts.toolSpoolDir, notesFileName(sessionId));

  const session = new Session({
    ...opts,
    sessionId,
    systemPrompt: buildSystemPrompt(opts.systemPrompt, opts.skills, opts.builtInTools, opts.maxTurns ?? DEFAULT_MAX_TURNS, opts.maxParallelToolCalls ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS, opts.toolSpoolDir, sessionId),
    llm,
    tools,
    mcp,
    contextLimit: contextLimitFor(llm.maxInputTokens, llm.maxOutputTokens),
  });

  if (opts.tools) {
    tools.registerAll(opts.tools);
  }

  if (opts.mcpServers) {
    await session.connectMCP(opts.mcpServers);
  }

  return session;
}
