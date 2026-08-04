import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolArgs } from "../src/llm/types.js";
import { errorMessage } from "../src/util/text.js";

test("missing or empty arguments parse to an empty object", () => {
  assert.deepEqual(parseToolArgs(undefined), { args: {} });
  assert.deepEqual(parseToolArgs(""), { args: {} });
});

test("a valid JSON object parses, preserving nested values", () => {
  const raw = JSON.stringify({ path: "a/b", nested: { x: 1 }, list: [1, 2] });
  const parsed = parseToolArgs(raw);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.args, { path: "a/b", nested: { x: 1 }, list: [1, 2] });
});

test("non-object JSON is rejected with an error", () => {
  for (const raw of ["null", "[]", "42", '"str"']) {
    const parsed = parseToolArgs(raw);
    assert.ok(parsed.error, `${raw} must produce an error`);
    assert.deepEqual(parsed.args, {});
  }
});

test("invalid JSON is rejected with the parse error", () => {
  const parsed = parseToolArgs("{bad");
  assert.ok(parsed.error);
  assert.deepEqual(parsed.args, {});
});

test("errorMessage renders any thrown value as text", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("boom"), "boom");
  assert.equal(errorMessage(null), "null");
});
