import type { Adapter, AssistantMessage, ChatOptions, LLMReasoningEffort, ResolvedLLMConfig } from "./types.js";

export abstract class BaseAdapter implements Adapter {
  readonly model: string;
  readonly reasoningEffort: LLMReasoningEffort;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;

  protected constructor(config: ResolvedLLMConfig) {
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort;
    this.maxInputTokens = config.maxInputTokens;
    this.maxOutputTokens = config.maxOutputTokens;
  }

  abstract stream(opts: ChatOptions): Promise<AssistantMessage>;
}
