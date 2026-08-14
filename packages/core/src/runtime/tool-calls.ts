import { mapWithConcurrency } from "../util/async.js";
import { MAX_PARALLEL_TOOL_CALLS } from "../util/constants.js";
import { parseToolArgs, type LLMAssistantMessage } from "../llm/messages.js";
import type { AgentEvent } from "./events.js";
import type { ToolRegistry } from "../tools/registry.js";
import { toolError, type TextResult, type ToolContext } from "../tools/types.js";

export interface ToolCallResult {
  id: string;
  content: string;
  resultSummary?: string;
  isError?: boolean;
  args: Record<string, unknown>;
}

export interface ToolCallDeps {
  tools: ToolRegistry;
  cwd: string;
}

export async function runToolCalls(
  calls: NonNullable<LLMAssistantMessage["tool_calls"]>,
  deps: ToolCallDeps,
  onEvent?: (e: AgentEvent) => void,
  signal?: AbortSignal
): Promise<ToolCallResult[] | null> {
  const results = await mapWithConcurrency(
    calls,
    MAX_PARALLEL_TOOL_CALLS,
    (call) => executeToolCall(call, deps, onEvent, signal),
    signal
  );
  return signal?.aborted ? null : results;
}

export async function executeToolCall(
  call: NonNullable<LLMAssistantMessage["tool_calls"]>[number],
  deps: ToolCallDeps,
  onEvent?: (e: AgentEvent) => void,
  signal?: AbortSignal
): Promise<ToolCallResult> {
  const parsed = parseToolArgs(call.function.arguments);
  const args = parsed.ok ? parsed.args : {};
  const argsError = parsed.ok ? undefined : toolError(`invalid arguments: ${parsed.error}`);
  const argsSummary = deps.tools.summarizeArgs(call.function.name, args);
  onEvent?.({ type: "toolStart", id: call.id, name: call.function.name, argsSummary, persisted: false });
  const ctx: ToolContext = { signal, cwd: deps.cwd };
  const start = performance.now();
  const result: TextResult = argsError ?? await deps.tools.execute(call.function.name, args, ctx);
  const duration = performance.now() - start;
  const resultSummary = deps.tools.summarizeResult(call.function.name, result, duration);
  if (!signal?.aborted) onEvent?.({ type: "toolEnd", id: call.id, result: result.content, isError: result.isError, resultSummary, persisted: false });
  return { id: call.id, content: result.content, resultSummary, isError: result.isError, args };
}
