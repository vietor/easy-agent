import type Anthropic from "@anthropic-ai/sdk";
import { parseToolArgs, toText, type LLMAssistantMessage, type LLMMessage } from "./messages.js";

const CONTINUE_CUE = "Continue the work, using the prior conversation as context.";

export function toAnthropicMessages(
  messages: LLMMessage[],
  includeThinking: boolean
): { system: string | undefined; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const rest: LLMMessage[] = [];
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
    !(rest[0] as LLMAssistantMessage).tool_calls?.length
  ) {
    const text = toText((rest[0] as LLMAssistantMessage).content);
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

function toMessageParam(m: LLMMessage, includeThinking: boolean): Anthropic.MessageParam {
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
  const a = m as LLMAssistantMessage;
  if (includeThinking && a.thinking) {
    for (const t of a.thinking) blocks.push(t as Anthropic.ContentBlockParam);
  }
  const text = toText(a.content);
  if (text) blocks.push({ type: "text", text });
  if (a.tool_calls) {
    for (const tc of a.tool_calls) {
      const parsed = parseToolArgs(tc.function.arguments);
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: parsed.ok ? parsed.args : {},
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
