import Anthropic, { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import type {
  AssistantMessage,
  LLMConfig,
  Message,
  ReasoningEffort,
  RedactedThinkingBlock,
  TextContentPart,
  ThinkingBlock,
} from "./types.js";
import type { ToolSchema } from "../tools/types.js";
import type { ChatOptions } from "./client.js";
import { netFetch } from "../util/net.js";

const THINKING_BUDGET: Record<ReasoningEffort, number> = {
  high: 16000,
  max: 32000,
};

const CONTINUE_CUE = "Continue the work, using the prior conversation as context.";

export function isAnthropicRetryable(e: unknown): boolean {
  if (e instanceof APIConnectionError) return true;
  if (e instanceof APIError && e.status) return e.status === 429 || e.status >= 500;
  return false;
}

export class AnthropicAdapter {
  private client: Anthropic;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;

  constructor(config: LLMConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      maxRetries: 0,
      fetch: netFetch,
    });
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort ?? "high";
  }

  async stream(opts: ChatOptions): Promise<AssistantMessage> {
    const useThinking = opts.reasoning !== false;
    const budget = THINKING_BUDGET[this.reasoningEffort];
    const { system, messages } = toAnthropicMessages(opts.messages, useThinking);

    const params: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: useThinking ? budget + 16384 : 16384,
      messages,
      ...(system && { system }),
      ...(useThinking && {
        thinking: { type: "enabled" as const, budget_tokens: budget },
      }),
      ...(opts.tools.length > 0 && { tools: opts.tools.map(toAnthropicTool) }),
    };

    const stream = this.client.messages.stream(params, { signal: opts.signal });
    if (opts.onDelta) stream.on("text", (delta) => opts.onDelta!(delta));
    if (opts.onReasoning) stream.on("thinking", (delta) => opts.onReasoning!(delta));

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

function toAnthropicMessages(
  messages: Message[],
  includeThinking: boolean
): { system: string | undefined; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const rest: Message[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = toText(m.content);
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
    const text = toText((rest[0] as AssistantMessage).content);
    if (text) system = system ? `${system}\n\n${text}` : text;
    rest.shift();
  }

  const out: Anthropic.MessageParam[] = [];
  for (const m of rest) {
    const param = toMessageParam(m, includeThinking);
    const last = out[out.length - 1];
    if (last && last.role === param.role) {
      last.content = mergeContent(last.content, param.content);
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
    return { role: "user", content: toText(m.content) };
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
  const text = toText(a.content);
  if (text) blocks.push({ type: "text", text });
  if (a.tool_calls) {
    for (const tc of a.tool_calls) {
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: parseInput(tc.function.arguments),
      });
    }
  }
  return { role: "assistant", content: blocks.length ? blocks : (text || "-") };
}

function mergeContent(
  a: Anthropic.MessageParam["content"],
  b: Anthropic.MessageParam["content"]
): Anthropic.MessageParam["content"] {
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

function toText(content: string | TextContentPart[] | null | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.map((p) => p.text).join("");
}

function parseInput(args: string): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}
