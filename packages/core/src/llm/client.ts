import { EmptyAssistantMessageError, type BaseAdapter, type LLMClient, type LLMConfig, type ResolvedLLMConfig } from "./types.js";
import { CompletionsAdapter } from "./completions.js";
import { AnthropicAdapter } from "./anthropic.js";
import { ResponsesAdapter } from "./responses.js";
import { isAbortError, withRetry, exponentialBackoff } from "../util/async.js";
import { DEFAULT_BACKEND, DEFAULT_MAX_INPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_REASONING_EFFORT, LLM_MAX_RETRIES } from "../util/constants.js";

export function isRetryableError(e: unknown, signal?: AbortSignal): boolean { // exported for testing
  if (signal?.aborted || isAbortError(e)) return false;
  if (e instanceof EmptyAssistantMessageError) return true;
  const name = (e as { name?: string }).name;
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError" || name === "APITimeoutError") return true;
  const status = (e as { status?: number }).status;
  if (status != null) return status === 429 || status >= 500;
  return false;
}

export function withRetryChat(adapter: BaseAdapter): LLMClient["chat"] {
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
        backoff: exponentialBackoff,
        onRetry: opts.onRetry,
        signal: opts.signal,
      }
    );
  };
}

export function createLLM(config: LLMConfig): LLMClient {
  const cfg: ResolvedLLMConfig = {
    ...config,
    reasoningEffort: config.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    wireApi: config.wireApi ?? DEFAULT_BACKEND,
    maxInputTokens: config.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  let adapter: BaseAdapter;
  switch (cfg.wireApi) {
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
    reasoningEffort: adapter.reasoningEffort,
    maxInputTokens: adapter.maxInputTokens,
    maxOutputTokens: adapter.maxOutputTokens,
    chat: withRetryChat(adapter),
  };
}

export function compactThresholdFor(maxInputTokens: number): number {
  return Math.floor(maxInputTokens * 0.75);
}
