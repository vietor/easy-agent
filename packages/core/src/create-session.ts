import { createLLM } from "./llm/client.js";
import { Session } from "./runtime/session.js";
import { isSessionScratchFile, notesFilePath, sessionFileName } from "./runtime/session-persistence.js";
import { ToolRegistry } from "./tools/registry.js";
import { MCPServerManager } from "./mcp/manager.js";
import { renderEnvironment, renderToolUsePrompt, TOOL_OUTPUT_GUIDANCE } from "./runtime/prompts.js";
import { CONTEXT_LIMIT_RATIO, DEFAULT_MAX_PARALLEL_TOOL_CALLS, DEFAULT_MAX_TURNS } from "./util/constants.js";
import { sweepDir } from "./util/sweep.js";
import { nextUuid } from "./util/uid.js";
import { TODO_WRITE_GUIDANCE } from "./tools/todo-write.js";
import { ASK_USER_GUIDANCE } from "./tools/ask-user.js";
import { renderSubAgentGuidance } from "./tools/sub-agent.js";
import type { SessionOptions } from "./runtime/session.js";

export const SYSTEM_PROMPT_BOUNDARY = '\n\n---\n<!-- SYSTEM_PROMPT_BOUNDARY -->\n\n';

function contextLimitFor(maxInputTokens: number, maxOutputTokens: number): number {
  return Math.floor(Math.min(maxInputTokens * CONTEXT_LIMIT_RATIO, maxInputTokens - maxOutputTokens));
}

interface SystemPromptLimits {
  sessionId: string;
  maxTurns: number;
  maxParallelToolCalls: number;
  maxSubAgentTurns: number;
}

function buildSystemPrompt(base: string, opts: SessionOptions, limits: SystemPromptLimits): string {
  const parts = [base];
  const { builtInTools, scratchDir, skills } = opts;
  const { sessionId, maxTurns, maxParallelToolCalls, maxSubAgentTurns } = limits;
  const mode = builtInTools === false ? "none" : builtInTools?.readOnly === true ? "readOnly" : "full";
  const toolUseLines = [renderToolUsePrompt(maxTurns, mode, scratchDir ? notesFilePath(scratchDir, sessionId) : undefined)];
  if (scratchDir) toolUseLines.push(TOOL_OUTPUT_GUIDANCE);
  if (typeof builtInTools === "object") {
    if (builtInTools.todoWrite) toolUseLines.push(TODO_WRITE_GUIDANCE);
    if (builtInTools.askUser) toolUseLines.push(ASK_USER_GUIDANCE);
    if (builtInTools.subAgent) toolUseLines.push(renderSubAgentGuidance(builtInTools.readOnly === true, maxParallelToolCalls, maxSubAgentTurns));
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
  const sessionId = opts.sessionId ?? nextUuid();
  if (!sessionId || sessionId === "." || sessionId === ".." || /[/\\]/.test(sessionId)) {
    throw new Error(`sessionId must be a single path segment, got "${sessionId}"`);
  }
  const cwd = opts.cwd ?? process.cwd();
  await Promise.all([
    opts.sessionDir ? sweepDir(opts.sessionDir, (name) => name === sessionFileName(sessionId)) : undefined,
    opts.scratchDir ? sweepDir(opts.scratchDir, (name) => isSessionScratchFile(name, sessionId)) : undefined,
  ]);

  const base = [opts.systemPrompt, renderEnvironment(cwd)].join(SYSTEM_PROMPT_BOUNDARY);
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxParallelToolCalls = opts.maxParallelToolCalls ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS;
  const maxSubAgentTurns = opts.maxSubAgentTurns ?? maxTurns;
  const session = new Session({
    ...opts,
    sessionId,
    cwd,
    maxTurns,
    maxParallelToolCalls,
    maxSubAgentTurns,
    systemPrompt: buildSystemPrompt(base, opts, { sessionId, maxTurns, maxParallelToolCalls, maxSubAgentTurns }),
    llm,
    tools,
    mcp,
    contextLimit: contextLimitFor(llm.maxInputTokens, llm.maxOutputTokens),
  });

  if (opts.tools) {
    tools.registerAll(opts.tools);
  }

  if (opts.mcpServers) {
    void session.connectMCP(opts.mcpServers);
  }

  return session;
}
