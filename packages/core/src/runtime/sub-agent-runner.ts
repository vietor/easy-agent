import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { Agent, type RunStatus } from "./agent.js";
import { renderToolUsePrompt } from "./prompts.js";
import type { LLMClient } from "../llm/types.js";
import { ToolRegistry } from "../tools/registry.js";

export interface SubAgentRunOptions {
  llm: LLMClient;
  tools: ToolRegistry;
  cwd: string;
  maxTurns: number;
  stallThreshold: number;
  contextLimit: number;
}

export interface SubAgentRunResult {
  status: RunStatus;
  reply: string;
  messages: SessionMessage[];
}

export function createSubAgentRunner(opts: SubAgentRunOptions): (systemPrompt: string, task: string, signal?: AbortSignal) => Promise<SubAgentRunResult> {
  return async (systemPrompt, task, signal) => {
    const conversation = new SessionMessages([systemPrompt, renderToolUsePrompt(opts.maxTurns)].join("\n\n"));
    const subTools = new ToolRegistry();
    subTools.registerAll(opts.tools.filter((t) => t.readOnly === true));
    const subAgent = new Agent({
      llm: opts.llm,
      conversation,
      tools: subTools,
      cwd: opts.cwd,
      setTodos: () => {},
      getTodos: () => [],
      stallThreshold: opts.stallThreshold,
      maxTurns: opts.maxTurns,
      contextLimit: opts.contextLimit,
    });
    const status = await subAgent.run(task, undefined, signal);
    const reply = conversation.lastAssistantText() || `(sub-agent produced no final text; status ${status})`;
    const messages = status !== "ok" ? conversation.export() : [];
    return { status, reply, messages };
  };
}
