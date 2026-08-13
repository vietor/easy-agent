import OpenAI from "openai";
import { EmptyAssistantMessageError, type ResolvedLLMConfig, type AssistantMessage, type ChatOptions } from "./types.js";
import { BaseAdapter } from "./base.js";
import { netFetch } from "../util/net.js";

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class CompletionsAdapter extends BaseAdapter {
  private client: OpenAI;

  constructor(config: ResolvedLLMConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
      fetch: netFetch,
    });
  }

  async stream(opts: ChatOptions): Promise<AssistantMessage> {
    const { messages, tools, onDelta, onThinking, onUsage, onToolCall, thinking, signal } = opts;
    let content = "";
    let refusal = "";
    const calls = new Map<number, ToolCallAccumulator>();
    const useThinking = thinking !== false;
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 && { tools }),
      ...(useThinking && { reasoning_effort: this.thinkingEffort })
    };
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
      const thinkingDelta = delta as { reasoning_content?: string | null; reasoning?: string | null };
      const thinkingText = thinkingDelta.reasoning_content ?? thinkingDelta.reasoning;
      if (thinkingText) {
        onThinking?.(thinkingText);
      }
      const refusalDelta = delta as { refusal?: string | null };
      if (refusalDelta.refusal) {
        refusal += refusalDelta.refusal;
        onDelta?.(refusalDelta.refusal);
      }
      if (delta.tool_calls) {
        onToolCall?.();
        for (const tc of delta.tool_calls) {
          let acc = calls.get(tc.index);
          if (!acc) {
            acc = { id: tc.id ?? "", name: "", arguments: "" };
            calls.set(tc.index, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    const message: AssistantMessage = {
      role: "assistant",
      content: content || refusal || null,
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
    if (!content && !refusal && !calls.size) {
      throw new EmptyAssistantMessageError();
    }
    return message;
  }
}
