import { Conversation, lastAssistantText, type ConversationMessage } from "./conversation.js";
import { Agent, type RunStatus } from "./agent.js";
import type { LLMClient } from "../llm/types.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface SubAgentRunOptions {
  llm: LLMClient;
  systemPrompt: string;
  tools: ToolRegistry;
  cwd: string;
  maxTurns: number;
  stallThreshold: number;
  contextLimit: number;
}

export function createSubAgentRun(opts: SubAgentRunOptions): (task: string, signal?: AbortSignal) => Promise<{ status: RunStatus; reply: string; messages: ConversationMessage[] }> {
  return async (task, signal) => {
    const conversation = new Conversation(opts.systemPrompt);
    const subAgent = new Agent({
      llm: opts.llm,
      conversation,
      tools: opts.tools,
      cwd: opts.cwd,
      setTodos: () => {},
      getTodos: () => [],
      stallThreshold: opts.stallThreshold,
      maxTurns: opts.maxTurns,
      contextLimit: opts.contextLimit,
    });
    const status = await subAgent.run(task, undefined, signal);
    const messages = conversation.export();
    const reply = lastAssistantText(messages) || `(sub-agent produced no final text; status ${status})`;
    return { status, reply, messages };
  };
}
