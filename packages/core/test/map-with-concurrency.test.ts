import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../src/util/async.js";
import { sleep, waitUntil } from "./helpers.js";

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

test("stops claiming new items once the signal is aborted", async () => {
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

test("starts the next item as soon as a slot frees", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const started: number[] = [];
  const promise = mapWithConcurrency([1, 2, 3], 2, async (n) => {
    started.push(n);
    if (n === 1) await gate;
    return n;
  });
  assert.ok(await waitUntil(() => started.length === 3, 1000));
  release();
  assert.deepEqual(await promise, [1, 2, 3]);
});

test("stops starting new items once one rejects", async () => {
  const started: number[] = [];
  const promise = mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    started.push(n);
    if (n === 1) throw new Error("boom");
    await sleep(5);
    return n;
  });
  await assert.rejects(promise, /boom/);
  await sleep(20);
  assert.deepEqual(started, [1, 2]);
});

test("returns items that completed in input order when the signal aborts", async () => {
  const ac = new AbortController();
  const results = await mapWithConcurrency(
    [1, 2, 3, 4],
    2,
    async (n) => {
      if (n === 2) ac.abort();
      await sleep(n === 1 ? 20 : 5);
      return n;
    },
    ac.signal
  );
  assert.deepEqual(results, [1, 2]);
});

test("rejects with the error of the lowest-index item that failed", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const promise = mapWithConcurrency([1, 2], 2, async (n) => {
    if (n === 2) {
      release();
      throw new Error("second failed");
    }
    await gate;
    throw new Error("first failed");
  });
  await assert.rejects(promise, /first failed/);
});
