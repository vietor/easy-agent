import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { Agent, type RunLimits, type RunStatus } from "./agent.js";
import { renderEnvironment, renderToolUsePrompt, TOOL_OUTPUT_GUIDANCE } from "./prompts.js";
import { notesFilePath } from "./session-persistence.js";
import type { LLMClient, LLMUsage } from "../llm/types.js";
import { isGrantedAtLevel, type AgentLevel } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createSubAgentTool, renderSubAgentGuidance, SUB_AGENT_DENIED_GUIDANCE } from "../tools/sub-agent.js";
import { MAX_TOOL_OUTPUT_BYTES, MAX_TOOL_OUTPUT_LINES, SUB_AGENT_TOOL_NAME } from "../util/constants.js";
import { truncateOutput } from "../util/text.js";

export interface SubAgentRunOptions extends RunLimits {
  llm: LLMClient;
  tools: ToolRegistry;
  cwd: string;
  sessionId: string;
  depth: number;
  maxSubAgentDepth: number;
  budget?: SubAgentBudget;
  onUsage?: (usage: LLMUsage) => void;
}

export interface SubAgentRunResult {
  status: RunStatus;
  reply: string;
  messages: SessionMessage[];
  notesPath?: string;
}

async function saveReport(notesPath: string, reply: string): Promise<string | undefined> {
  const cut = truncateOutput(reply, "head", MAX_TOOL_OUTPUT_BYTES, MAX_TOOL_OUTPUT_LINES);
  const body = cut.truncated ? `${cut.text}\n\n(report truncated in this file: first ${cut.keptLines} of ${cut.totalLines} lines)` : reply;
  try {
    await mkdir(dirname(notesPath), { recursive: true });
    await appendFile(notesPath, `\n## Sub-agent report\n\n${body}\n`, "utf-8");
    return notesPath;
  } catch {
    return undefined;
  }
}

export class SubAgentBudget {
  private running = 0;

  constructor(readonly limit: number) {}

  tryAcquire(): boolean {
    if (this.running >= this.limit) return false;
    this.running++;
    return true;
  }

  release(): void {
    this.running--;
  }
}

export async function runSubAgent(
  opts: SubAgentRunOptions,
  systemPrompt: string,
  task: string,
  level: AgentLevel,
  signal?: AbortSignal
): Promise<SubAgentRunResult> {
  const { llm, tools, cwd, sessionId, onUsage, depth, maxSubAgentDepth, budget, ...limits } = opts;
  if (budget && !budget.tryAcquire()) {
    throw new Error(`sub-agent limit reached: ${budget.limit} sub-agents are already running in this session; do not retry — wait for the running sub-agents to report back, or do this work yourself with the tools you have`);
  }
  try {
    const mode = level === 1 ? "readOnly" : "full";
    const canSpawn = depth < maxSubAgentDepth;
    const notesPath = limits.scratchDir ? notesFilePath(limits.scratchDir, `${sessionId}.${randomUUID()}`) : undefined;
    const prompt = [systemPrompt, renderEnvironment(cwd), renderToolUsePrompt(limits.maxTurns, mode, notesPath)];
    if (limits.scratchDir) prompt.push(TOOL_OUTPUT_GUIDANCE);
    prompt.push(canSpawn ? renderSubAgentGuidance(mode === "readOnly", limits.maxParallelToolCalls, limits.maxTurns) : SUB_AGENT_DENIED_GUIDANCE);
    const conversation = new SessionMessages(prompt.join("\n\n"));
    const subTools = new ToolRegistry();
    subTools.registerAll(tools.filter((t) => t.name !== SUB_AGENT_TOOL_NAME && isGrantedAtLevel(t.agentLevel, level)));
    if (canSpawn) {
      subTools.register(createSubAgentTool({
        runSubAgent: (subPrompt, subTask, subLevel, subSignal) =>
          runSubAgent({ ...opts, depth: depth + 1 }, subPrompt, subTask, subLevel, subSignal),
      }, mode === "readOnly"));
    }
    const subAgent = new Agent({
      llm,
      conversation,
      tools: subTools,
      cwd,
      getTodos: () => [],
      ...limits,
      notesPath: mode === "full" ? notesPath : undefined,
    });
    const status = await subAgent.run(task, undefined, signal);
    onUsage?.(subAgent.usage);
    const reply = conversation.lastAssistantText() || `(sub-agent produced no final text; status ${status})`;
    const messages = status !== "ok" ? conversation.export() : [];
    const savedNotes = notesPath ? await saveReport(notesPath, reply) : undefined;
    return { status, reply, messages, notesPath: savedNotes };
  } finally {
    budget?.release();
  }
}
