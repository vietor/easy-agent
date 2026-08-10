import OpenAI from "openai";
import { EmptyAssistantMessageError, type BaseAdapter, type ResolvedLLMConfig, type AssistantMessage, type ChatOptions, type LLMReasoningEffort, type Message } from "./types.js";
import { netFetch } from "../util/net.js";

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class CompletionsAdapter implements BaseAdapter {
  private client: OpenAI;
  readonly model: string;
  readonly reasoningEffort: LLMReasoningEffort;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;

  constructor(config: ResolvedLLMConfig) {
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort;
    this.maxInputTokens = config.maxInputTokens;
    this.maxOutputTokens = config.maxOutputTokens;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
      fetch: netFetch,
    });
  }

  async stream(opts: ChatOptions): Promise<AssistantMessage> {
    const { tools, onDelta, onReasoning, onUsage, reasoning, signal } = opts;
    const messages = fixupInterruptedToolCalls(opts.messages);
    let content = "";
    let refusal = "";
    const calls = new Map<number, ToolCallAccumulator>();
    const useThinking = reasoning !== false;
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0 && { tools }),
      ...(useThinking && { reasoning_effort: this.reasoningEffort })
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
    if (!content && !refusal && !calls.size) {
      throw new EmptyAssistantMessageError();
    }
    return message;
  }
}

function fixupInterruptedToolCalls(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    out.push(m);
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    const satisfied = new Set<string>();
    for (let j = i + 1; j < messages.length && messages[j].role === "tool"; j++) {
      satisfied.add((messages[j] as { tool_call_id: string }).tool_call_id);
    }
    for (const tc of m.tool_calls) {
      if (!satisfied.has(tc.id)) {
        out.push({ role: "tool", tool_call_id: tc.id, content: "(interrupted)" });
      }
    }
  }
  return out;
}
