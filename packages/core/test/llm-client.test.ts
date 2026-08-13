import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableError, withRetryChat } from "../src/llm/client.js";
import { EmptyAssistantMessageError, type Adapter } from "../src/llm/types.js";

function fakeAdapter(stream: Adapter["stream"]): Adapter {
  return { model: "test-model", reasoningEffort: "high", maxInputTokens: 1000, maxOutputTokens: 100, stream };
}

test("connection and timeout errors are retryable", () => {
  for (const name of ["APIConnectionError", "APIConnectionTimeoutError", "APITimeoutError"]) {
    assert.equal(isRetryableError({ name }), true, name);
  }
});

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
    throw { name: "APIConnectionError" };
  });
  await assert.rejects(withRetryChat(adapter)({ messages: [], tools: [] }));
  assert.equal(attempts, 1);
});

test("chat retries an attempt that failed before emitting a tool call", async () => {
  let attempts = 0;
  const adapter = fakeAdapter(async () => {
    attempts++;
    if (attempts === 1) throw { name: "APIConnectionError" };
    return { role: "assistant", content: "ok" };
  });
  const result = await withRetryChat(adapter)({ messages: [], tools: [] });
  assert.equal(attempts, 2);
  assert.equal(result.content, "ok");
});
