import { SessionMessages, lastAssistantText, type SessionMessage } from "./session-messages.js";
import { Agent, type RunStatus } from "./agent.js";
import { TOOL_USE_PROMPT } from "./prompts.js";
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

export function createSubAgentRun(opts: SubAgentRunOptions): (systemPrompt: string, task: string, signal?: AbortSignal) => Promise<{ status: RunStatus; reply: string; messages: SessionMessage[] }> {
  return async (systemPrompt, task, signal) => {
    const conversation = new SessionMessages([systemPrompt, TOOL_USE_PROMPT, `- Turn budget: ${opts.maxTurns} tool-calling turns per run.`].join("\n\n"));
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
    const messages = conversation.export();
    const reply = lastAssistantText(messages) || `(sub-agent produced no final text; status ${status})`;
    return { status, reply, messages };
  };
}
