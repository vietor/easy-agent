import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { Agent, type RunLimits, type RunStatus } from "./agent.js";
import { renderEnvironment, renderToolUsePrompt, TOOL_OUTPUT_GUIDANCE } from "./prompts.js";
import type { SessionEvent } from "./events.js";
import type { LLMClient, LLMUsage } from "../llm/types.js";
import { isGrantedAtLevel, type AgentLevel } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createSubAgentTool, renderSubAgentGuidance, SUB_AGENT_DENIED_GUIDANCE } from "../tools/sub-agent.js";
import { AbortedError } from "../util/async.js";
import { NOT_EXECUTED_PREFIX, SUB_AGENT_TOOL_NAME } from "../util/constants.js";

interface SubAgentRunOptions extends RunLimits {
  llm: LLMClient;
  tools: ToolRegistry;
  cwd: string;
  depth: number;
  maxSubAgentDepth: number;
  budget?: SubAgentBudget;
  onUsage?: (usage: LLMUsage) => void;
  onEvent?: (e: SessionEvent) => void;
}

export interface SubAgentRunResult {
  status: RunStatus;
  reply: string;
  messages: SessionMessage[];
}

interface SlotWaiter {
  failuresAtEnqueue: number;
  resume: (skipped: boolean) => void;
}

const SKIPPED_MESSAGE = `${NOT_EXECUTED_PREFIX}an earlier sub-agent in this turn failed, so the remaining delegated calls were skipped — re-issue this one in a later turn if it is still needed, or do this work yourself with the tools you have)`;

export class SubAgentBudget {
  private running = 0;
  private failures = 0;
  private readonly waiters: SlotWaiter[] = [];

  constructor(readonly limit: number) {}

  tryAcquire(): boolean {
    if (this.running >= this.limit) return false;
    this.running++;
    return true;
  }

  reportFailure(): void {
    this.failures++;
  }

  release(): void {
    this.running--;
    while (true) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      if (waiter.failuresAtEnqueue < this.failures) {
        waiter.resume(true);
        continue;
      }
      this.running++;
      waiter.resume(false);
      return;
    }
  }

  waitForSlot(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: SlotWaiter = {
        failuresAtEnqueue: this.failures,
        resume: (skipped) => {
          signal?.removeEventListener("abort", onAbort);
          if (skipped) reject(new Error(SKIPPED_MESSAGE));
          else resolve();
        },
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new AbortedError());
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export async function runSubAgent(
  opts: SubAgentRunOptions,
  systemPrompt: string,
  task: string,
  level: AgentLevel,
  signal?: AbortSignal
): Promise<SubAgentRunResult> {
  const { llm, tools, cwd, onUsage, onEvent, depth, maxSubAgentDepth, budget, ...limits } = opts;
  if (budget && !budget.tryAcquire()) {
    if (depth > 1) {
      throw new Error(`sub-agent limit reached: ${budget.limit} sub-agents are already running in this session; do not retry in this turn — once the running sub-agents report back, delegate the remaining work in a later turn, or do this work yourself with the tools you have`);
    }
    await budget.waitForSlot(signal);
  }
  try {
    const mode = level === 1 ? "readOnly" : "full";
    const canSpawn = depth < maxSubAgentDepth;
    const prompt = [systemPrompt, renderEnvironment(cwd), renderToolUsePrompt(limits.maxTurns, mode)];
    if (limits.scratchDir) prompt.push(TOOL_OUTPUT_GUIDANCE);
    prompt.push(canSpawn ? renderSubAgentGuidance(mode === "readOnly", limits.maxParallelToolCalls, limits.maxTurns, budget?.limit) : SUB_AGENT_DENIED_GUIDANCE);
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
    });
    const status = await subAgent.run(task, onEvent, signal);
    if (depth === 1 && status !== "ok") budget?.reportFailure();
    onUsage?.(subAgent.usage);
    const reply = conversation.lastAssistantText() || `(sub-agent produced no final text; status ${status})`;
    const messages = status !== "ok" ? conversation.export() : [];
    return { status, reply, messages };
  } finally {
    budget?.release();
  }
}
