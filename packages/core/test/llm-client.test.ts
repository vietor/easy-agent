import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { isRetryableError, withRetryChat } from "../src/llm/client.js";
import { EmptyAssistantMessageError, IncompleteStreamError, TruncatedResponseError } from "../src/llm/messages.js";
import type { LLMAdapter } from "../src/llm/types.js";

function fakeAdapter(stream: LLMAdapter["stream"]): LLMAdapter {
  return { model: "test-model", thinkingEffort: "high", maxInputTokens: 1000, maxOutputTokens: 100, stream };
}

test("429 and 5xx statuses are retryable, other 4xx are not", () => {
  for (const status of [429, 500, 503]) {
    assert.equal(isRetryableError({ status }), true, String(status));
  }
  for (const status of [400, 404]) {
    assert.equal(isRetryableError({ status }), false, String(status));
  }
});

test("ordinary errors and non-error throws are not retryable", () => {
  assert.equal(isRetryableError(new Error("boom")), false);
  assert.equal(isRetryableError("boom"), false);
});

test("empty model response errors are retryable", () => {
  assert.equal(isRetryableError(new EmptyAssistantMessageError()), true);
});

test("SDK connection errors are retryable", () => {
  assert.equal(isRetryableError(new Anthropic.APIConnectionError({ message: "socket hang up" })), true);
  assert.equal(isRetryableError(new Anthropic.APIConnectionTimeoutError({})), true);
  assert.equal(isRetryableError(new OpenAI.APIConnectionError({ message: "socket hang up" })), true);
});

test("abort-shaped errors are never retryable", () => {
  assert.equal(isRetryableError(new Anthropic.APIUserAbortError()), false);
  assert.equal(isRetryableError(new OpenAI.APIUserAbortError()), false);
  assert.equal(isRetryableError(new DOMException("aborted", "AbortError")), false);
});

test("fetch failures and incomplete streams are retryable, truncation is not", () => {
  assert.equal(isRetryableError(new TypeError("fetch failed")), true);
  assert.equal(isRetryableError(new IncompleteStreamError("stream ended without a finish reason")), true);
  assert.equal(isRetryableError(new TruncatedResponseError("response truncated")), false);
});

test("an already-aborted signal is never retryable", () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isRetryableError({ status: 500 }, controller.signal), false);
});

test("chat does not retry an attempt that already emitted a tool call", async () => {
  let attempts = 0;
  const adapter = fakeAdapter(async (opts) => {
    attempts++;
    opts.onToolCall?.();
    throw { status: 500 };
  });
  await assert.rejects(withRetryChat(adapter)({ messages: [], tools: [] }));
  assert.equal(attempts, 1);
});

test("chat retries an attempt that failed before emitting a tool call", async () => {
  let attempts = 0;
  const adapter = fakeAdapter(async () => {
    attempts++;
    if (attempts === 1) throw { status: 500 };
    return { role: "assistant", content: "ok" };
  });
  const result = await withRetryChat(adapter)({ messages: [], tools: [] });
  assert.equal(attempts, 2);
  assert.equal(result.content, "ok");
});
