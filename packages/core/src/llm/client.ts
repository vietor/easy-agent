import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { EmptyAssistantMessageError, IncompleteStreamError } from "./messages.js";
import { LLMConfigSchema, type LLMAdapter, type LLMClient, type LLMConfig } from "./types.js";
import { CompletionsAdapter, ResponsesAdapter } from "./openai.js";
import { AnthropicAdapter } from "./anthropic.js";
import { isAbortError, withRetry, backoffDelay, retryAfterDelay } from "../util/async.js";
import { LLM_MAX_RETRIES } from "../util/constants.js";

export function isRetryableError(e: unknown, signal?: AbortSignal): boolean { // exported for testing
  if (signal?.aborted || isAbortError(e)) return false;
  if (e instanceof Anthropic.APIUserAbortError || e instanceof OpenAI.APIUserAbortError) return false;
  if (e instanceof Anthropic.APIConnectionError || e instanceof OpenAI.APIConnectionError) return true;
  if (e instanceof EmptyAssistantMessageError || e instanceof IncompleteStreamError) return true;
  if (e instanceof TypeError) return true;
  const status = (e as { status?: number }).status;
  if (status != null) return status === 429 || status >= 500;
  return false;
}

export function withRetryChat(adapter: LLMAdapter): LLMClient["chat"] {
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
        backoff: (attempt, error) => retryAfterDelay(error) ?? backoffDelay(attempt),
        onRetry: opts.onRetry,
        signal: opts.signal,
      }
    );
  };
}

export function isLLMClient(llm: LLMConfig | LLMClient): llm is LLMClient {
  return typeof (llm as LLMClient).chat === "function";
}

export function createLLM(config: LLMConfig): LLMClient {
  const cfg = LLMConfigSchema.parse(config);
  let adapter: LLMAdapter;
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
    vision: cfg.vision,
    chat: withRetryChat(adapter),
  };
}
