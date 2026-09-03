import { test } from "node:test";
import assert from "node:assert/strict";
import { toResponsesInput, toResponsesTool } from "../src/llm/responses.js";

test("a tool-call turn converts to message, function_call, and function_call_output items", () => {
  const items = toResponsesInput([
    { role: "system", content: "You are an agent." },
    { role: "user", content: "read the file" },
    {
      role: "assistant",
      content: "on it",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } },
        { id: "call_2", type: "function", function: { name: "Glob", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "contents" },
    { role: "tool", tool_call_id: "call_2", content: "matches" },
    { role: "user", content: "thanks" },
  ]);
  assert.deepEqual(items, [
    { type: "message", role: "system", content: [{ type: "input_text", text: "You are an agent." }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "read the file" }] },
    { type: "message", role: "assistant", content: [{ type: "input_text", text: "on it" }] },
    { type: "function_call", call_id: "call_1", name: "Read", arguments: "{}" },
    { type: "function_call", call_id: "call_2", name: "Glob", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "contents" },
    { type: "function_call_output", call_id: "call_2", output: "matches" },
    { type: "message", role: "user", content: [{ type: "input_text", text: "thanks" }] },
  ]);
});

test("consecutive same-role messages stay separate", () => {
  const items = toResponsesInput([
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "user", content: "c" },
  ]);
  assert.equal(items.length, 3);
  assert.deepEqual(items[1], { type: "message", role: "user", content: [{ type: "input_text", text: "b" }] });
});

test("empty content produces no item", () => {
  const items = toResponsesInput([
    { role: "system", content: "" },
    { role: "system", content: [] },
    { role: "user", content: "" },
    { role: "assistant", content: null },
  ]);
  assert.deepEqual(items, []);
});

test("thinking blocks are dropped", () => {
  const items = toResponsesInput([
    {
      role: "assistant",
      content: "answer",
      thinking: [{ type: "thinking", thinking: "steps", signature: "sig" }],
    },
  ]);
  assert.deepEqual(items, [{ type: "message", role: "assistant", content: [{ type: "input_text", text: "answer" }] }]);
});

test("string and content-part text both convert to input_text", () => {
  const items = toResponsesInput([
    { role: "user", content: "hi" },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ]);
  assert.deepEqual(items, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
  ]);
});

test("tool result with empty content keeps empty output", () => {
  const items = toResponsesInput([{ role: "tool", tool_call_id: "call_7", content: "" }]);
  assert.deepEqual(items, [{ type: "function_call_output", call_id: "call_7", output: "" }]);
});

test("toResponsesTool flattens the function schema", () => {
  assert.deepEqual(
    toResponsesTool({ type: "function", function: { name: "Echo", description: "echo", parameters: { type: "object" } } }),
    { type: "function", name: "Echo", description: "echo", parameters: { type: "object" }, strict: false }
  );
});
