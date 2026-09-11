import type { LLMAssistantMessage } from "./messages.js";
import type { Adapter, ChatOptions, LLMThinkingEffort, ResolvedLLMConfig } from "./types.js";

export abstract class BaseAdapter implements Adapter {
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
