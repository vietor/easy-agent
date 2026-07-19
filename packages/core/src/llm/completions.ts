import OpenAI, { APIConnectionError, APIError } from "openai";
import type { LLMConfig, ReasoningEffort, AssistantMessage } from "./types.js";
import type { ChatOptions } from "./client.js";
import { netFetch } from "../util/net.js";

interface ToolCallAcc {
  id: string;
  name: string;
  arguments: string;
}

export function isCompletionsRetryable(e: unknown): boolean {
  if (e instanceof APIConnectionError) return true;
  if (e instanceof APIError && e.status) return e.status === 429 || e.status >= 500;
  return false;
}

export class CompletionsAdapter {
  private client: OpenAI;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
      fetch: netFetch,
    });
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort ?? "high";
  }

  async stream(opts: ChatOptions): Promise<AssistantMessage> {
    const { messages, tools, onDelta, onReasoning, onUsage, reasoning, signal } = opts;
    let content = "";
    const calls = new Map<number, ToolCallAcc>();
    const useReasoning = reasoning !== false;
    const params: Record<string, unknown> = {
      model: this.model,
      messages,
      tools,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (useReasoning) params.reasoning_effort = this.reasoningEffort;
    const stream = await this.client.chat.completions.create(
      params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      { signal }
    );

    for await (const chunk of stream) {
      if (chunk.usage) {
        onUsage?.(chunk.usage.prompt_tokens ?? 0, chunk.usage.completion_tokens ?? 0);
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onDelta?.(delta.content);
      }
      const reasoningText = (delta as { reasoning_content?: string | null; reasoning?: string | null }).reasoning_content
        ?? (delta as { reasoning?: string | null }).reasoning;
      if (reasoningText) {
        onReasoning?.(reasoningText);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          let acc = calls.get(tc.index);
          if (!acc) {
            acc = { id: tc.id ?? "", name: "", arguments: "" };
            calls.set(tc.index, acc);
          }
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    const message: AssistantMessage = {
      role: "assistant",
      content: content || null,
    };
    if (calls.size) {
      message.tool_calls = [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, acc]) => ({
          id: acc.id,
          type: "function" as const,
          function: { name: acc.name, arguments: acc.arguments },
        }));
    }
    return message;
  }
}
