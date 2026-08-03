import type { ToolSchema } from "../tools/types.js";

export type ReasoningEffort = "high" | "max";

export type WireApi = "completions" | "anthropic";

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  wireApi?: WireApi;
  contextWindow?: number;
}

/** LLMConfig with optional fields resolved to their defaults by `createLLM`. */
export interface ResolvedLLMConfig extends LLMConfig {
  reasoningEffort: ReasoningEffort;
  wireApi: WireApi;
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
  onRetry?: (attempt: number, max: number) => void;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export interface LLMClient {
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
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
    return { args: JSON.parse(args) as Record<string, unknown> };
  } catch (e) {
    return { args: {}, error: (e as Error).message };
  }
}

export function compactThresholdFor(contextWindow: number): number {
  return Math.floor(contextWindow * 0.75);
}
