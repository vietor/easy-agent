import { randomUUID } from "node:crypto";
import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { Agent, type RunLimits, type RunStatus } from "./agent.js";
import { renderEnvironment, renderToolUsePrompt, TOOL_OUTPUT_GUIDANCE } from "./prompts.js";
import { notesFilePath } from "../util/file.js";
import type { LLMClient, LLMUsage } from "../llm/types.js";
import { isGrantedAtLevel, type AgentLevel } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";

export interface SubAgentRunOptions extends RunLimits {
  llm: LLMClient;
  tools: ToolRegistry;
  cwd: string;
  onUsage?: (usage: LLMUsage) => void;
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
  const mode = level === 1 ? "readOnly" : "full";
  const notesPath = mode === "full" && limits.scratchDir ? notesFilePath(limits.scratchDir, randomUUID()) : undefined;
  const prompt = [systemPrompt, renderEnvironment(cwd), renderToolUsePrompt(limits.maxTurns, mode, notesPath)];
  if (limits.scratchDir) prompt.push(TOOL_OUTPUT_GUIDANCE);
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
    notesPath,
  });
  const status = await subAgent.run(task, undefined, signal);
  onUsage?.(subAgent.usage);
  const reply = conversation.lastAssistantText() || `(sub-agent produced no final text; status ${status})`;
  const messages = status !== "ok" ? conversation.export() : [];
  return { status, reply, messages };
}
