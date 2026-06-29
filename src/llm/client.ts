import OpenAI, { APIConnectionError } from "openai";
import type { LLMConfig } from "../config.js";
import type { AssistantMessage, Message, ToolSchema } from "./types.js";
import { withRetry } from "../util/async.js";

const MAX_RETRIES = 3;

interface ToolCallAcc {
  id: string;
  name: string;
  arguments: string;
}

export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
    });
    this.model = config.model;
  }

  async chat(
    messages: Message[],
    tools: ToolSchema[],
    onDelta?: (text: string) => void,
    onRetry?: (attempt: number, max: number) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    return withRetry(() => this.streamOnce(messages, tools, onDelta, signal), {
      retries: MAX_RETRIES,
      retryable: (e) => e instanceof APIConnectionError,
      backoff: (attempt) => 1000 * 2 ** attempt,
      onRetry,
      signal,
    });
  }

  private async streamOnce(
    messages: Message[],
    tools: ToolSchema[],
    onDelta?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    let content = "";
    const calls = new Map<number, ToolCallAcc>();
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        tools,
        stream: true,
      },
      { signal }
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onDelta?.(delta.content);
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
