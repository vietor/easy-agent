import { EmptyAssistantMessageError, type BaseAdapter, type LLMClient, type LLMConfig, type ResolvedLLMConfig, type LLMReasoningEffort, type LLMWireApi } from "./types.js";
import { CompletionsAdapter } from "./completions.js";
import { AnthropicAdapter } from "./anthropic.js";
import { withRetry } from "../util/async.js";

const DEFAULT_REASONING_EFFORT: LLMReasoningEffort = "high";
const DEFAULT_WIRE_API: LLMWireApi = "completions";
const DEFAULT_MAX_INPUT_TOKENS = 1_000_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 128_000;

const MAX_RETRIES = 3;

export function isRetryableError(e: unknown, signal?: AbortSignal): boolean { // exported for testing
  if (signal?.aborted) return false;
  if (e instanceof EmptyAssistantMessageError) return true;
  const name = (e as { name?: string }).name;
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError" || name === "APITimeoutError") return true;
  const status = (e as { status?: number }).status;
  if (status != null) return status === 429 || status >= 500;
  return false;
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
  const cfg: ResolvedLLMConfig = {
    ...config,
    reasoningEffort: config.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    wireApi: config.wireApi ?? DEFAULT_WIRE_API,
    maxInputTokens: config.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  const adapter = cfg.wireApi === "anthropic"
    ? new AnthropicAdapter(cfg)
    : new CompletionsAdapter(cfg);
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
