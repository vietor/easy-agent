import OpenAI from "openai";
import {
  EmptyAssistantMessageError,
  toText,
  type LLMAssistantMessage,
  type LLMMessage,
} from "./messages.js";
import type { ChatOptions, ResolvedLLMConfig } from "./types.js";
import { BaseAdapter } from "./base.js";
import type { ToolSchema } from "../tools/types.js";
import { netFetch } from "../util/net.js";

export function createOpenAIClient(config: ResolvedLLMConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    maxRetries: 0,
    fetch: netFetch,
  });
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class CompletionsAdapter extends BaseAdapter {
  private client: OpenAI;

  constructor(config: ResolvedLLMConfig) {
    super(config);
    this.client = createOpenAIClient(config);
  }

  async stream(opts: ChatOptions): Promise<LLMAssistantMessage> {
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
        const cached = (chunk.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0;
        onUsage?.(cached, (chunk.usage.prompt_tokens ?? 0) - cached, chunk.usage.completion_tokens ?? 0);
      }
      const delta = chunk.choices?.[0]?.delta;
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

    const message: LLMAssistantMessage = {
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

type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;

export class ResponsesAdapter extends BaseAdapter {
  private client: OpenAI;

  constructor(config: ResolvedLLMConfig) {
    super(config);
    this.client = createOpenAIClient(config);
  }

  async stream(opts: ChatOptions): Promise<LLMAssistantMessage> {
    const { messages, tools, onDelta, onThinking, onUsage, onToolCall, thinking, signal } = opts;
    const useThinking = thinking !== false;
    const params: Record<string, unknown> = {
      model: this.model,
      input: toResponsesInput(messages),
      max_output_tokens: this.maxOutputTokens,
      stream: true,
      ...(tools.length > 0 && { tools: tools.map(toResponsesTool) }),
      ...(useThinking && {
        reasoning: { effort: this.thinkingEffort },
        include: ["reasoning.summary_text"],
      }),
    };
    const stream = await this.client.responses.create(
      params as unknown as OpenAI.Responses.ResponseCreateParamsStreaming,
      { signal }
    );

    let finalResponse: OpenAI.Responses.Response | undefined;
    for await (const event of stream) {
      switch (event.type) {
        case "response.output_text.delta":
          onDelta?.(event.delta);
          break;
        case "response.refusal.delta":
          onDelta?.(event.delta);
          break;
        case "response.reasoning_summary_text.delta":
          onThinking?.(event.delta);
          break;
        case "response.output_item.added":
          if (event.item.type === "function_call") onToolCall?.();
          break;
        case "response.completed":
        case "response.failed":
          finalResponse = event.response;
          break;
      }
    }

    if (!finalResponse) throw new EmptyAssistantMessageError();
    if (finalResponse.status === "failed") {
      const detail = finalResponse.error
        ? `${finalResponse.error.code}: ${finalResponse.error.message}`
        : "unknown error";
      throw new Error(`Responses API error: ${detail}`);
    }
    if (finalResponse.usage) {
      const cacheTokens = finalResponse.usage.input_tokens_details?.cached_tokens ?? 0;
      onUsage?.(cacheTokens, finalResponse.usage.input_tokens - cacheTokens, finalResponse.usage.output_tokens);
    }

    const textParts: string[] = [];
    const toolCalls: NonNullable<LLMAssistantMessage["tool_calls"]> = [];
    for (const item of finalResponse.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") textParts.push(part.text);
          else if (part.type === "refusal") textParts.push(part.refusal);
        }
      } else if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        });
      }
    }
    const content = textParts.join("") || null;
    const message: LLMAssistantMessage = { role: "assistant", content };
    if (toolCalls.length) message.tool_calls = toolCalls;
    if (!content && !toolCalls.length) {
      throw new EmptyAssistantMessageError();
    }
    return message;
  }
}

export function toResponsesTool(schema: ToolSchema): OpenAI.Responses.FunctionTool {
  return {
    type: "function",
    name: schema.function.name,
    description: schema.function.description,
    parameters: schema.function.parameters,
    strict: false,
  };
}

export function toResponsesInput(messages: LLMMessage[]): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = toText(m.content);
      if (text) items.push({ type: "message", role: "system", content: [{ type: "input_text", text }] });
    } else if (m.role === "user") {
      const text = toText(m.content);
      if (text) items.push({ type: "message", role: "user", content: [{ type: "input_text", text }] });
    } else if (m.role === "tool") {
      items.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
    } else {
      const text = toText(m.content);
      if (text) items.push({ type: "message", role: "assistant", content: [{ type: "input_text", text }] });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          items.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
        }
      }
    }
  }
  return items;
}
