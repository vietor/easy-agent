import type { ToolSchema } from "../tools/types.js";
import type { LLMAssistantMessage, LLMMessage } from "./messages.js";

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

export interface ChatOptions {
  messages: LLMMessage[];
  tools: ToolSchema[];
  onDelta?: (text: string) => void;
  onThinking?: (text: string) => void;
  onRetry?: (attempt: number, max: number, error: unknown) => void;
  onUsage?: (cacheInputTokens: number, missInputTokens: number, outputTokens: number) => void;
  onToolCall?: () => void;
  thinking?: boolean;
  signal?: AbortSignal;
}

export interface LLMClient {
  readonly model: string;
  readonly thinkingEffort: LLMThinkingEffort;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  chat(opts: ChatOptions): Promise<LLMAssistantMessage>;
}

export interface Adapter extends Omit<LLMClient, "chat"> {
  stream(opts: ChatOptions): Promise<LLMAssistantMessage>;
}
