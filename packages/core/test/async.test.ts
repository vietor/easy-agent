import { test } from "node:test";
import assert from "node:assert/strict";
import { AbortedError, isAbortError, isTimeout, withTimeoutSignal, withAbort, withRetry, withTimeoutFn } from "../src/util/async.js";
import { sleep, waitUntil } from "./helpers.js";

test("AbortedError carries name and message", () => {
  const e = new AbortedError();
  assert.ok(e instanceof Error);
  assert.equal(e.name, "AbortedError");
  assert.equal(e.message, "aborted");
});

test("isAbortError matches every abort shape and rejects others", () => {
  assert.equal(isAbortError(new AbortedError()), true);
  assert.equal(isAbortError(new DOMException("x", "AbortError")), true);
  assert.equal(isAbortError({ name: "AbortError" }), true);
  assert.equal(isAbortError({ name: "APIUserAbortError" }), true);
  assert.equal(isAbortError(new Error("boom")), false);
  assert.equal(isAbortError({ name: "TimeoutError" }), false);
  assert.equal(isAbortError(undefined), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError("x"), false);
});

test("withAbort resolves the underlying promise when not aborted", async () => {
  assert.equal(await withAbort(Promise.resolve(42)), 42);
});

test("withAbort with a pre-aborted signal rejects with AbortedError", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withAbort(Promise.resolve(42), controller.signal), AbortedError);
});

test("withAbort rejects with AbortedError when the signal aborts mid-flight", async () => {
  const controller = new AbortController();
  const p = withAbort(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(p, AbortedError);
});

test("withAbort invokes onAbort exactly once", async () => {
  const controller = new AbortController();
  let calls = 0;
  const p = withAbort(new Promise(() => {}), controller.signal, () => {
    calls++;
    return 7;
  });
  controller.abort();
  controller.abort();
  assert.equal(await p, 7);
  assert.equal(calls, 1);
});

test("withRetry retries retryable failures then succeeds", async () => {
  let attempts = 0;
  const p = withRetry(async () => {
    attempts++;
    if (attempts < 3) throw new Error("transient");
    return "ok";
  }, { retries: 3, retryable: () => true, backoff: () => 1 });
  assert.equal(await p, "ok");
  assert.equal(attempts, 3);
});

test("withRetry aborts during backoff with AbortedError and does not retry the fn", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const p = withRetry(async () => {
    attempts++;
    throw new Error("boom");
  }, { retries: 5, retryable: () => true, backoff: () => 100_000, signal: controller.signal });
  assert.ok(await waitUntil(() => attempts === 1, 5000));
  controller.abort();
  await assert.rejects(p, AbortedError);
  assert.equal(attempts, 1);
});

test("withRetry does not retry non-retryable errors", async () => {
  let attempts = 0;
  const err = new Error("fatal");
  const p = withRetry(async () => {
    attempts++;
    throw err;
  }, { retries: 3, retryable: () => false, backoff: () => 1 });
  await assert.rejects(p, (e: unknown) => e === err);
  assert.equal(attempts, 1);
});

test("isTimeout reports the timeout reason, not an external abort", async () => {
  const controller = new AbortController();
  const timed = withTimeoutSignal(controller.signal, 20);
  await sleep(40);
  assert.equal(timed.aborted, true);
  assert.equal(isTimeout(timed), true);
  const external = withTimeoutSignal(controller.signal, 1000);
  controller.abort();
  assert.equal(external.aborted, true);
  assert.equal(isTimeout(external), false);
});

test("withTimeoutFn throws the timeout message on timeout", async () => {
  const p = withTimeoutFn(
    (signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
    }),
    20,
    undefined,
    "boom-timeout"
  );
  const assertion = assert.rejects(p, /boom-timeout/);
  await sleep(60);
  await assertion;
});

test("withTimeoutFn propagates an external abort, not the timeout message", async () => {
  const controller = new AbortController();
  const p = withTimeoutFn(
    (signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new AbortedError()));
    }),
    1000,
    controller.signal,
    "boom-timeout"
  );
  controller.abort();
  await assert.rejects(p, (e: unknown) => isAbortError(e) && !(e as Error).message.includes("boom-timeout"));
});

test("withTimeoutFn with a pre-aborted external signal rejects with the abort error", async () => {
  const controller = new AbortController();
  controller.abort();
  const p = withTimeoutFn(
    (signal) => new Promise((_, reject) => {
      if (signal.aborted) reject(new DOMException("aborted", "AbortError"));
    }),
    1000,
    controller.signal,
    "boom-timeout"
  );
  await assert.rejects(p, (e: unknown) => isAbortError(e) && !(e as Error).message.includes("boom-timeout"));
});
