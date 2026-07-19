import type { LLMConfig, ReasoningEffort, WireApi, AssistantMessage, Message } from "./types.js";
import type { ToolSchema } from "../tools/types.js";
import { withRetry } from "../util/async.js";
import { CompletionsAdapter, isCompletionsRetryable } from "./completions.js";
import { AnthropicAdapter, isAnthropicRetryable } from "./anthropic.js";

const MAX_RETRIES = 3;

export interface ChatOptions {
  messages: Message[];
  tools: ToolSchema[];
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onRetry?: (attempt: number, max: number) => void;
  onUsage?: (promptTokens: number, completionTokens: number) => void;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export class LLMClient {
  private readonly wire: WireApi;
  private readonly backend: CompletionsAdapter | AnthropicAdapter;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;

  constructor(config: LLMConfig) {
    this.wire = config.wireApi ?? "completions";
    const adapter = this.wire === "anthropic" ? new AnthropicAdapter(config) : new CompletionsAdapter(config);
    this.backend = adapter;
    this.model = adapter.model;
    this.reasoningEffort = adapter.reasoningEffort;
  }

  async chat(opts: ChatOptions): Promise<AssistantMessage> {
    return withRetry(() => this.backend.stream(opts), {
      retries: MAX_RETRIES,
      retryable: this.wire === "anthropic" ? isAnthropicRetryable : isCompletionsRetryable,
      backoff: (attempt) => 1000 * 2 ** attempt,
      onRetry: opts.onRetry,
      signal: opts.signal,
    });
  }
}
