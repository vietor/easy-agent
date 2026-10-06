import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolCallArgs } from "../src/llm/messages.js";
import { LLMConfigSchema } from "../src/llm/types.js";
import { toErrorMessage } from "../src/util/text.js";

test("LLMConfigSchema passes headers through and defaults them to undefined", () => {
  const base = { baseUrl: "https://example.test/v1", apiKey: "k", model: "m" };
  const parsed = LLMConfigSchema.parse({ ...base, headers: { "X-Route": "team-a" } });
  assert.deepEqual(parsed.headers, { "X-Route": "team-a" });
  assert.equal(LLMConfigSchema.parse(base).headers, undefined);
});

test("missing or empty arguments parse to an empty object", () => {
  assert.deepEqual(parseToolCallArgs(undefined), { ok: true, args: {} });
  assert.deepEqual(parseToolCallArgs(""), { ok: true, args: {} });
});

test("a valid JSON object parses, preserving nested values", () => {
  const raw = JSON.stringify({ path: "a/b", nested: { x: 1 }, list: [1, 2] });
  const parsed = parseToolCallArgs(raw);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.args, { path: "a/b", nested: { x: 1 }, list: [1, 2] });
});

test("non-object JSON is rejected with an error", () => {
  for (const raw of ["null", "[]", "42", '"str"']) {
    const parsed = parseToolCallArgs(raw);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.ok(parsed.error, `${raw} must produce an error`);
  }
});

test("invalid JSON is rejected with the parse error", () => {
  const parsed = parseToolCallArgs("{bad");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.ok(parsed.error);
});

test("toErrorMessage renders any thrown value as text", () => {
  assert.equal(toErrorMessage(new Error("boom")), "boom");
  assert.equal(toErrorMessage("boom"), "boom");
  assert.equal(toErrorMessage(null), "null");
});
