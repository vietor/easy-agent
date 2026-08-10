import Anthropic from "@anthropic-ai/sdk";
import {
  EmptyAssistantMessageError,
  type BaseAdapter,
  parseToolArgs,
  textOf,
  type AssistantMessage,
  type ChatOptions,
  type ResolvedLLMConfig,
  type Message,
  type LLMReasoningEffort,
  type RedactedThinkingBlock,
  type ThinkingBlock,
} from "./types.js";
import type { ToolSchema } from "../tools/types.js";
import { netFetch } from "../util/net.js";

const THINKING_BUDGET: Record<LLMReasoningEffort, number> = {
  high: 16000,
  max: 32000,
};

const CONTINUE_CUE = "Continue the work, using the prior conversation as context.";

export class AnthropicAdapter implements BaseAdapter {
  private client: Anthropic;
  readonly model: string;
  readonly reasoningEffort: LLMReasoningEffort;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;

  constructor(config: ResolvedLLMConfig) {
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort;
    this.maxInputTokens = config.maxInputTokens;
    this.maxOutputTokens = config.maxOutputTokens;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
      fetch: netFetch,
    });
  }

  async stream(opts: ChatOptions): Promise<AssistantMessage> {
    const useThinking = opts.reasoning !== false;
    const budget = THINKING_BUDGET[this.reasoningEffort];
    const { system, messages } = toAnthropicMessages(opts.messages, useThinking);

    const params: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      messages,
      ...(system && { system }),
      ...(useThinking && {
        thinking: { type: "enabled" as const, budget_tokens: Math.min(budget, this.maxOutputTokens - 1) },
        output_config: { effort: this.reasoningEffort },
      }),
      ...(opts.tools.length > 0 && { tools: opts.tools.map(toAnthropicTool) }),
    };

    const stream = this.client.messages.stream(params, { signal: opts.signal });
    if (opts.onDelta) stream.on("text", (delta) => opts.onDelta!(delta));
    if (opts.onReasoning) stream.on("thinking", (delta) => opts.onReasoning!(delta));
    if (opts.onToolCall) stream.on("contentBlock", (block) => { if (block.type === "tool_use") opts.onToolCall!(); });

    const final = await stream.finalMessage();
    opts.onUsage?.(final.usage.input_tokens, final.usage.output_tokens);

    const thinking: Array<ThinkingBlock | RedactedThinkingBlock> = [];
    let text = "";
    const toolCalls: NonNullable<AssistantMessage["tool_calls"]> = [];
    for (const block of final.content) {
      if (block.type === "thinking") {
        thinking.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
      } else if (block.type === "redacted_thinking") {
        thinking.push({ type: "redacted_thinking", data: block.data });
      } else if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      }
    }

    const message: AssistantMessage = {
      role: "assistant",
      content: text || null,
    };
    if (thinking.length) message.thinking = thinking;
    if (toolCalls.length) message.tool_calls = toolCalls;
    if (!text && !thinking.length && !toolCalls.length) {
      throw new EmptyAssistantMessageError();
    }
    return message;
  }
}

function toAnthropicTool(schema: ToolSchema): Anthropic.Tool {
  return {
    name: schema.function.name,
    description: schema.function.description,
    input_schema: schema.function.parameters as Anthropic.Tool["input_schema"],
  };
}

export function toAnthropicMessages(
  messages: Message[],
  includeThinking: boolean
): { system: string | undefined; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const rest: Message[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = textOf(m.content);
      system = system ? `${system}\n\n${text}` : text;
    } else {
      rest.push(m);
    }
  }

  while (
    rest.length > 0 &&
    rest[0].role === "assistant" &&
    !(rest[0] as AssistantMessage).tool_calls?.length
  ) {
    const text = textOf((rest[0] as AssistantMessage).content);
    if (text) system = system ? `${system}\n\n${text}` : text;
    rest.shift();
  }

  const out: Anthropic.MessageParam[] = [];
  for (const m of rest) {
    const param = toMessageParam(m, includeThinking);
    const last = out[out.length - 1];
    if (last && last.role === param.role) {
      const merged = mergeContent(last.content, param.content);
      if (merged === null) out.push(param);
      else last.content = merged;
    } else {
      out.push(param);
    }
  }

  if (out.length === 0 || out[0].role === "assistant") {
    out.unshift({ role: "user", content: CONTINUE_CUE });
  }

  return { system, messages: out };
}

function toMessageParam(m: Message, includeThinking: boolean): Anthropic.MessageParam {
  if (m.role === "user") {
    return { role: "user", content: textOf(m.content) };
  }
  if (m.role === "tool") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }],
    };
  }
  const blocks: Anthropic.ContentBlockParam[] = [];
  const a = m as AssistantMessage;
  if (includeThinking && a.thinking) {
    for (const t of a.thinking) blocks.push(t as Anthropic.ContentBlockParam);
  }
  const text = textOf(a.content);
  if (text) blocks.push({ type: "text", text });
  if (a.tool_calls) {
    for (const tc of a.tool_calls) {
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: parseToolArgs(tc.function.arguments).args,
      });
    }
  }
  return { role: "assistant", content: blocks.length ? blocks : (text || "-") };
}

function hasToolResult(content: Anthropic.MessageParam["content"]): boolean {
  return Array.isArray(content) && content.some((block) => (block as { type?: string }).type === "tool_result");
}

function hasText(content: Anthropic.MessageParam["content"]): boolean {
  return typeof content === "string" ? content.length > 0 : content.some((b) => b.type === "text");
}

function mergeContent(
  a: Anthropic.MessageParam["content"],
  b: Anthropic.MessageParam["content"]
): Anthropic.MessageParam["content"] | null {
  const aText = hasText(a);
  const bText = hasText(b);
  if ((aText || bText) && (hasToolResult(a) || hasToolResult(b))) return null;
  if (typeof a === "string" && typeof b === "string") return a ? `${a}\n${b}` : b;
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (typeof a === "string") {
    if (a) blocks.push({ type: "text", text: a });
  } else {
    blocks.push(...a);
  }
  if (typeof b === "string") {
    if (b) blocks.push({ type: "text", text: b });
  } else {
    blocks.push(...b);
  }
  return blocks;
}

