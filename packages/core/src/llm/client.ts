import { EmptyAssistantMessageError } from "./messages.js";
import { LLMConfigSchema, type Adapter, type LLMClient, type LLMConfig } from "./types.js";
import { CompletionsAdapter, ResponsesAdapter } from "./openai.js";
import { AnthropicAdapter } from "./anthropic.js";
import { isAbortError, withRetry, backoffDelay } from "../util/async.js";
import { LLM_MAX_RETRIES } from "../util/constants.js";

export function isRetryableError(e: unknown, signal?: AbortSignal): boolean { // exported for testing
  if (signal?.aborted || isAbortError(e)) return false;
  if (e instanceof EmptyAssistantMessageError) return true;
  const name = (e as { name?: string }).name;
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError" || name === "APITimeoutError") return true;
  const status = (e as { status?: number }).status;
  if (status != null) return status === 429 || status >= 500;
  return false;
}

export function withRetryChat(adapter: Adapter): LLMClient["chat"] {
  return (opts) => {
    let sawToolCall = false;
    return withRetry(
      () => {
        sawToolCall = false;
        return adapter.stream({ ...opts, onToolCall: () => { sawToolCall = true; } });
      },
      {
        retries: LLM_MAX_RETRIES,
        retryable: (e) => !sawToolCall && isRetryableError(e, opts.signal),
        backoff: backoffDelay,
        onRetry: opts.onRetry,
        signal: opts.signal,
      }
    );
  };
}

export function createLLM(config: LLMConfig): LLMClient {
  const cfg = LLMConfigSchema.parse(config);
  let adapter: Adapter;
  switch (cfg.backend) {
    case "responses":
      adapter = new ResponsesAdapter(cfg);
      break;
    case "anthropic":
      adapter = new AnthropicAdapter(cfg);
      break;
    default:
      adapter = new CompletionsAdapter(cfg);
  }
  return {
    model: adapter.model,
    thinkingEffort: adapter.thinkingEffort,
    maxInputTokens: adapter.maxInputTokens,
    maxOutputTokens: adapter.maxOutputTokens,
    chat: withRetryChat(adapter),
  };
}
