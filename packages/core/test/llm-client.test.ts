import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableError } from "../src/llm/client.js";

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

test("an already-aborted signal is never retryable", () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isRetryableError({ status: 500 }, controller.signal), false);
});
