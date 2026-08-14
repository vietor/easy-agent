import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolArgs } from "../src/llm/messages.js";
import { toErrorMessage } from "../src/util/text.js";

test("missing or empty arguments parse to an empty object", () => {
  assert.deepEqual(parseToolArgs(undefined), { ok: true, args: {} });
  assert.deepEqual(parseToolArgs(""), { ok: true, args: {} });
});

test("a valid JSON object parses, preserving nested values", () => {
  const raw = JSON.stringify({ path: "a/b", nested: { x: 1 }, list: [1, 2] });
  const parsed = parseToolArgs(raw);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.args, { path: "a/b", nested: { x: 1 }, list: [1, 2] });
});

test("non-object JSON is rejected with an error", () => {
  for (const raw of ["null", "[]", "42", '"str"']) {
    const parsed = parseToolArgs(raw);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.ok(parsed.error, `${raw} must produce an error`);
  }
});

test("invalid JSON is rejected with the parse error", () => {
  const parsed = parseToolArgs("{bad");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.error);
});

test("toErrorMessage renders any thrown value as text", () => {
  assert.equal(toErrorMessage(new Error("boom")), "boom");
  assert.equal(toErrorMessage("boom"), "boom");
  assert.equal(toErrorMessage(null), "null");
});
