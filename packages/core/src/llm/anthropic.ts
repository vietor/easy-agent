import Anthropic from "@anthropic-ai/sdk";
import {
  EmptyAssistantMessageError,
  type LLMAssistantMessage,
  type RedactedThinkingBlock,
  type ThinkingBlock,
} from "./messages.js";
import type { ChatOptions, LLMThinkingEffort, ResolvedLLMConfig } from "./types.js";
import { BaseAdapter } from "./base.js";
import { toAnthropicMessages } from "./anthropic-messages.js";
import type { ToolSchema } from "../tools/types.js";
import { netFetch } from "../util/net.js";

export const THINKING_BUDGET: Record<LLMThinkingEffort, number> = {
  high: 16000,
  max: 32000,
};

export class AnthropicAdapter extends BaseAdapter {
  private client: Anthropic;

  constructor(config: ResolvedLLMConfig) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
      fetch: netFetch,
    });
  }

  async stream(opts: ChatOptions): Promise<LLMAssistantMessage> {
    const useThinking = opts.thinking !== false;
    const budget = THINKING_BUDGET[this.thinkingEffort];
    const { system, messages } = toAnthropicMessages(opts.messages, useThinking);
    const tools = opts.tools.map(toAnthropicTool);

    const cacheControl = { type: "ephemeral" as const };
    const systemCached = system
      ? [{ type: "text" as const, text: system, cache_control: cacheControl }]
      : undefined;
    const toolsCached =
      tools.length > 0 && !system
        ? [...tools.slice(0, -1), { ...tools[tools.length - 1], cache_control: cacheControl }]
        : undefined;

    const params: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      messages,
      ...(systemCached && { system: systemCached }),
      ...(useThinking && {
        thinking: { type: "enabled" as const, budget_tokens: Math.min(budget, this.maxOutputTokens - 1) },
        output_config: { effort: this.thinkingEffort },
      }),
      ...(tools.length > 0 && { tools: toolsCached ?? tools }),
    };

    const stream = this.client.messages.stream(params, { signal: opts.signal });
    if (opts.onUsage) stream.on("streamEvent", (e) => { if (e.type === "message_start") opts.onUsage!(e.message.usage.input_tokens, 0); });
    if (opts.onDelta) stream.on("text", (delta) => opts.onDelta!(delta));
    if (opts.onThinking) stream.on("thinking", (delta) => opts.onThinking!(delta));
    if (opts.onToolCall) stream.on("contentBlock", (block) => { if (block.type === "tool_use") opts.onToolCall!(); });

    const final = await stream.finalMessage();
    opts.onUsage?.(final.usage.input_tokens, final.usage.output_tokens);

    const thinking: Array<ThinkingBlock | RedactedThinkingBlock> = [];
    let text = "";
    const toolCalls: NonNullable<LLMAssistantMessage["tool_calls"]> = [];
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

    const message: LLMAssistantMessage = {
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

