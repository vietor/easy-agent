import { randomUUID } from "node:crypto";
import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { Agent, type RunLimits, type RunStatus } from "./agent.js";
import { renderToolUsePrompt, TOOL_OUTPUT_GUIDANCE } from "./prompts.js";
import { notesFilePath } from "../util/file.js";
import type { LLMClient } from "../llm/types.js";
import { isGrantedAtLevel, type AgentLevel } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";

export interface SubAgentRunOptions extends RunLimits {
  llm: LLMClient;
  tools: ToolRegistry;
  cwd: string;
  onUsage?: (cacheInputTokens: number, missInputTokens: number, outputTokens: number) => void;
}

export interface SubAgentRunResult {
  status: RunStatus;
  reply: string;
  messages: SessionMessage[];
}

export async function runSubAgent(
  opts: SubAgentRunOptions,
  systemPrompt: string,
  task: string,
  level: AgentLevel,
  signal?: AbortSignal
): Promise<SubAgentRunResult> {
  const { llm, tools, cwd, onUsage, ...limits } = opts;
  const environment = `Environment:\n- Platform: ${process.platform}\n- Working directory: ${cwd}`;
  const mode = level === 1 ? "readOnly" : "full";
  const notesPath = mode === "full" && limits.toolSpoolDir ? notesFilePath(limits.toolSpoolDir, randomUUID()) : undefined;
  const prompt = [systemPrompt, environment, renderToolUsePrompt(limits.maxTurns, mode, notesPath)];
  if (limits.toolSpoolDir) prompt.push(TOOL_OUTPUT_GUIDANCE);
  const conversation = new SessionMessages(prompt.join("\n\n"));
  const subTools = new ToolRegistry();
  subTools.registerAll(tools.filter((t) => isGrantedAtLevel(t.agentLevel, level)));
  const subAgent = new Agent({
    llm,
    conversation,
    tools: subTools,
    cwd,
    setTodos: () => {},
    getTodos: () => [],
    ...limits,
  });
  const status = await subAgent.run(task, undefined, signal);
  onUsage?.(subAgent.usage.cacheInputTokens, subAgent.usage.missInputTokens, subAgent.usage.outputTokens);
  const reply = conversation.lastAssistantText() || `(sub-agent produced no final text; status ${status})`;
  const messages = status !== "ok" ? conversation.export() : [];
  return { status, reply, messages };
}
