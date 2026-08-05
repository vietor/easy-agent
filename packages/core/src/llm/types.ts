import type { ToolSchema } from "../tools/types.js";
import { errorMessage } from "../util/text.js";

export type LLMReasoningEffort = "high" | "max";

export type LLMWireApi = "completions" | "anthropic";

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: LLMReasoningEffort;
  wireApi?: LLMWireApi;
  contextWindow?: number;
}

/** LLMConfig with optional fields resolved to their defaults by `createLLM`. */
export interface ResolvedLLMConfig extends LLMConfig {
  reasoningEffort: LLMReasoningEffort;
  wireApi: LLMWireApi;
  contextWindow: number;
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
  onReasoning?: (text: string) => void;
  onRetry?: (attempt: number, max: number, error: unknown) => void;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export interface LLMClient {
  readonly model: string;
  readonly reasoningEffort: LLMReasoningEffort;
  readonly contextWindow: number;
  chat(opts: ChatOptions): Promise<AssistantMessage>;
}

export interface BaseAdapter extends Omit<LLMClient, "chat"> {
  stream(opts: ChatOptions): Promise<AssistantMessage>;
}

export function textOf(content: string | TextContentPart[] | null | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.map((p) => p.text).join("");
}

export function parseToolArgs(args: string | undefined): { args: Record<string, unknown>; error?: string } {
  if (!args) return { args: {} };
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { args: {}, error: "arguments must be a JSON object" };
    }
    return { args: parsed as Record<string, unknown> };
  } catch (e) {
    return { args: {}, error: errorMessage(e) };
  }
}
