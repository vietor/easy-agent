import type { LLMAssistantMessage } from "./messages.js";
import type { ChatOptions, LLMAdapter, LLMThinkingEffort, ResolvedLLMConfig } from "./types.js";

export abstract class BaseLLMAdapter implements LLMAdapter {
  readonly model: string;
  readonly thinkingEffort: LLMThinkingEffort;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;

  protected constructor(config: ResolvedLLMConfig) {
    this.model = config.model;
    this.thinkingEffort = config.thinkingEffort;
    this.maxInputTokens = config.maxInputTokens;
    this.maxOutputTokens = config.maxOutputTokens;
  }

  abstract stream(opts: ChatOptions): Promise<LLMAssistantMessage>;
}
