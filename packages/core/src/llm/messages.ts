import { toErrorMessage } from "../util/text.js";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}

export interface LLMAssistantMessage {
  role: "assistant";
  content: string | null | TextContentPart[];
  tool_calls?: ToolCall[];
  thinking?: Array<ThinkingBlock | RedactedThinkingBlock>;
}

export type LLMMessage =
  | { role: "system"; content: string | TextContentPart[] }
  | { role: "user"; content: string | TextContentPart[]; name?: string }
  | LLMAssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export function toText(content: string | TextContentPart[] | null | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.map((p) => p.text).join("");
}

export class EmptyAssistantMessageError extends Error {
  constructor() {
    super("empty assistant message: no content, refusal, thinking, or tool calls");
    this.name = "EmptyAssistantMessageError";
  }
}

export function parseToolArgs(
  args: string | undefined
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!args) return { ok: true, args: {} };
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "arguments must be a JSON object" };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: toErrorMessage(e) };
  }
}
