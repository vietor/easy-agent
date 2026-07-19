import type { AssistantMessage, ChatOptions, LLMClient, LLMConfig } from "./types.js";
import { CompletionsAdapter } from "./completions.js";
import { AnthropicAdapter } from "./anthropic.js";
import { withRetry } from "../util/async.js";

export type { LLMClient, ChatOptions };

const MAX_RETRIES = 3;

function isRetryableError(e: unknown): boolean {
  if ((e as { name?: string }).name === "APIConnectionError") return true;
  const status = (e as { status?: number }).status;
  return status != null && status >= 500;
}

interface Adapter {
  readonly model: string;
  stream(opts: ChatOptions): Promise<AssistantMessage>;
}

function withRetryChat(adapter: Adapter): LLMClient["chat"] {
  return (opts) =>
    withRetry(() => adapter.stream(opts), {
      retries: MAX_RETRIES,
      retryable: isRetryableError,
      backoff: (attempt) => 1000 * 2 ** attempt,
      onRetry: opts.onRetry,
      signal: opts.signal,
    });
}

export function createLLM(config: LLMConfig): LLMClient {
  const adapter = config.wireApi === "anthropic"
    ? new AnthropicAdapter(config)
    : new CompletionsAdapter(config);
  return {
    model: adapter.model,
    reasoningEffort: adapter.reasoningEffort,
    chat: withRetryChat(adapter),
  };
}
