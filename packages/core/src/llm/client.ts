import type { BaseAdapter, ChatOptions, LLMClient, LLMConfig } from "./types.js";
import { CompletionsAdapter } from "./completions.js";
import { AnthropicAdapter } from "./anthropic.js";
import { withRetry } from "../util/async.js";

export type { LLMClient, ChatOptions };

const MAX_RETRIES = 3;

function isRetryableError(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if ((e as { name?: string }).name === "APIConnectionError") return true;
  const status = (e as { status?: number }).status;
  if (status != null) return status === 429 || status >= 500;
  // no HTTP status: connection-level failure (DNS, refused, dropped stream)
  return true;
}

function withRetryChat(adapter: BaseAdapter): LLMClient["chat"] {
  return (opts) =>
    withRetry(() => adapter.stream(opts), {
      retries: MAX_RETRIES,
      retryable: (e) => isRetryableError(e, opts.signal),
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
    contextWindow: adapter.contextWindow,
    chat: withRetryChat(adapter),
  };
}
