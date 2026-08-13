import type { ToolSchema } from "../tools/types.js";
import { errorMessage } from "../util/text.js";

export type LLMThinkingEffort = "high" | "max";

export type LLMBackend = "completions" | "anthropic" | "responses";

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  thinkingEffort?: LLMThinkingEffort;
  backend?: LLMBackend;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface ResolvedLLMConfig extends LLMConfig {
  thinkingEffort: LLMThinkingEffort;
  backend: LLMBackend;
  maxInputTokens: number;
  maxOutputTokens: number;
}

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

export interface AssistantMessage {
  role: "assistant";
  content: string | null | TextContentPart[];
  tool_calls?: ToolCall[];
  thinking?: Array<ThinkingBlock | RedactedThinkingBlock>;
}

export type Message =
  | { role: "system"; content: string | TextContentPart[] }
  | { role: "user"; content: string | TextContentPart[]; name?: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatOptions {
  messages: Message[];
  tools: ToolSchema[];
  onDelta?: (text: string) => void;
  onThinking?: (text: string) => void;
  onRetry?: (attempt: number, max: number, error: unknown) => void;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  onToolCall?: () => void;
  thinking?: boolean;
  signal?: AbortSignal;
}

export interface LLMClient {
  readonly model: string;
  readonly thinkingEffort: LLMThinkingEffort;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  chat(opts: ChatOptions): Promise<AssistantMessage>;
}

export interface Adapter extends Omit<LLMClient, "chat"> {
  stream(opts: ChatOptions): Promise<AssistantMessage>;
}

export function textOf(content: string | TextContentPart[] | null | undefined): string {
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
    return { ok: false, error: errorMessage(e) };
  }
}
