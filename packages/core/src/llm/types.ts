import { z } from "zod";
import type { ToolSchema } from "../tools/types.js";
import type { LLMAssistantMessage, LLMMessage } from "./messages.js";

export const LLMConfigSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  thinkingEffort: z.enum(["high", "max"]).default("high"),
  backend: z.enum(["completions", "anthropic", "responses"]).default("completions"),
  maxInputTokens: z.int().positive().default(1_000_000),
  maxOutputTokens: z.int().positive().default(128_000),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

export type LLMThinkingEffort = LLMConfig["thinkingEffort"];

export type LLMBackend = LLMConfig["backend"];

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
