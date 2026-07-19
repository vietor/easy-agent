import OpenAI, { APIConnectionError, APIError } from "openai";
import type { LLMConfig, ReasoningEffort, AssistantMessage, Message } from "./types.js";
import type { ToolSchema } from "../tools/types.js";
import { withRetry } from "../util/async.js";
import { netFetch } from "../util/net.js";

const MAX_RETRIES = 3;

interface ToolCallAcc {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatOptions {
  messages: Message[];
  tools: ToolSchema[];
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onRetry?: (attempt: number, max: number) => void;
  onUsage?: (promptTokens: number, completionTokens: number) => void;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export class LLMClient {
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
    this.reasoningEffort = config.reasoningEffort ?? "none";
  }

  async chat(opts: ChatOptions): Promise<AssistantMessage> {
    return withRetry(() => this.streamOnce(opts.messages, opts.tools, opts.onDelta, opts.onReasoning, opts.onUsage, opts.reasoning, opts.signal), {
      retries: MAX_RETRIES,
      retryable: (e) => {
        if (e instanceof APIConnectionError) return true;
        if (e instanceof APIError && e.status) return e.status === 429 || e.status >= 500;
        return false;
      },
      backoff: (attempt) => 1000 * 2 ** attempt,
      onRetry: opts.onRetry,
      signal: opts.signal,
    });
  }

  private async streamOnce(
    messages: Message[],
    tools: ToolSchema[],
    onDelta?: (text: string) => void,
    onReasoning?: (text: string) => void,
    onUsage?: (promptTokens: number, completionTokens: number) => void,
    reasoning?: boolean,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    let content = "";
    const calls = new Map<number, ToolCallAcc>();
    const useReasoning = reasoning !== false && this.reasoningEffort !== "none";
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
