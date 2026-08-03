import OpenAI from "openai";
import { type BaseAdapter, type ResolvedLLMConfig, type AssistantMessage, type ChatOptions, type ReasoningEffort } from "./types.js";
import { netFetch } from "../util/net.js";

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class CompletionsAdapter implements BaseAdapter {
  private client: OpenAI;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly contextWindow: number;

  constructor(config: ResolvedLLMConfig) {
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort;
    this.contextWindow = config.contextWindow;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
      fetch: netFetch,
    });
  }

  async stream(opts: ChatOptions): Promise<AssistantMessage> {
    const { messages, tools, onDelta, onReasoning, onUsage, reasoning, signal } = opts;
    let content = "";
    let refusal = "";
    const calls = new Map<number, ToolCallAccumulator>();
    const useReasoning = reasoning !== false;
    const params: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 && { tools }),
      ...(useReasoning && { reasoning_effort: this.reasoningEffort === "max" ? "xhigh" : this.reasoningEffort })
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
      const reasoningDelta = delta as { reasoning_content?: string | null; reasoning?: string | null };
      const reasoningText = reasoningDelta.reasoning_content ?? reasoningDelta.reasoning;
      if (reasoningText) {
        onReasoning?.(reasoningText);
      }
      const refusalDelta = delta as { refusal?: string | null };
      if (refusalDelta.refusal) {
        refusal += refusalDelta.refusal;
        onDelta?.(refusalDelta.refusal);
      }
      if (delta.tool_calls) {
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
    return message;
  }
}
