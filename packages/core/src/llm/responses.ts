import OpenAI from "openai";
import {
  EmptyAssistantMessageError,
  textOf,
  type AssistantMessage,
  type BaseAdapter,
  type ChatOptions,
  type LLMReasoningEffort,
  type Message,
  type ResolvedLLMConfig,
} from "./types.js";
import type { ToolSchema } from "../tools/types.js";
import { netFetch } from "../util/net.js";

type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;

export class ResponsesAdapter implements BaseAdapter {
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
    const { messages, tools, onDelta, onReasoning, onUsage, onToolCall, reasoning, signal } = opts;
    const useThinking = reasoning !== false;
    const params: Record<string, unknown> = {
      model: this.model,
      input: toResponsesInput(messages),
      max_output_tokens: this.maxOutputTokens,
      stream: true,
      ...(tools.length > 0 && { tools: tools.map(toResponsesTool) }),
      ...(useThinking && {
        reasoning: { effort: this.reasoningEffort === "max" ? "high" : this.reasoningEffort },
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
          onReasoning?.(event.delta);
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
      onUsage?.(finalResponse.usage.input_tokens, finalResponse.usage.output_tokens);
    }

    const textParts: string[] = [];
    const toolCalls: NonNullable<AssistantMessage["tool_calls"]> = [];
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
    const message: AssistantMessage = { role: "assistant", content };
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

export function toResponsesInput(messages: Message[]): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = textOf(m.content);
      if (text) items.push({ type: "message", role: "system", content: [{ type: "input_text", text }] });
    } else if (m.role === "user") {
      const text = textOf(m.content);
      if (text) items.push({ type: "message", role: "user", content: [{ type: "input_text", text }] });
    } else if (m.role === "tool") {
      items.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
    } else {
      const text = textOf(m.content);
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
