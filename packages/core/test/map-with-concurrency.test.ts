import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../src/util/async.js";

test("runs at most limit calls at once and preserves order", async () => {
  let inflight = 0;
  let maxInflight = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 10));
    inflight--;
    return n * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.ok(maxInflight <= 2);
});

test("stops launching further chunks once the signal is aborted", async () => {
  const ac = new AbortController();
  let started = 0;
  const results = await mapWithConcurrency(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    3,
    async (n) => {
      started++;
      if (n === 3) ac.abort();
      await new Promise((r) => setTimeout(r, 5));
      return n;
    },
    ac.signal
  );
  assert.ok(started <= 3);
  assert.ok(results.length <= 3);
});

test("empty input returns empty results", async () => {
  const results = await mapWithConcurrency([], 3, async (n: number) => n);
  assert.deepEqual(results, []);
});
