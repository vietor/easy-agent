import { test } from "node:test";
import assert from "node:assert/strict";
import { toAnthropicMessages } from "../src/llm/anthropic.js";
import type { Message } from "../src/llm/types.js";

test("dangling tool_use at the end gets a placeholder tool_result", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "WebFetch", arguments: "{}" } }] },
    ],
    true
  );
  assert.equal(messages[1].role, "assistant");
  assert.deepEqual(messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "(interrupted)" }] });
});

test("tool_use in the middle without results also gets a placeholder", () => {
  // a follow-up user message (e.g. a todo reminder) after the dangling tool_use
  // used to hide the problem from the last-message-only guard
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "WebFetch", arguments: "{}" } }] },
      { role: "user", content: "<system-reminder>Tasks: ..." },
    ],
    true
  );
  const idx = messages.findIndex((m) => m.role === "assistant");
  assert.deepEqual(messages[idx + 1], { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "(interrupted)" }] });
  assert.equal(messages[idx + 2].role, "user");
});

test("satisfied tool_use is left untouched", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Echo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "echoed" },
    ],
    true
  );
  assert.equal(messages.length, 3);
  assert.equal(messages[2].role, "user");
});

test("consecutive dangling tool_use messages merge and get one placeholder covering both ids", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Echo", arguments: "{}" } }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_2", type: "function", function: { name: "Echo", arguments: "{}" } }] },
    ],
    true
  );
  const last = messages[messages.length - 1];
  assert.equal(last.role, "user");
  assert.deepEqual(last.content, [
    { type: "tool_result", tool_use_id: "call_1", content: "(interrupted)" },
    { type: "tool_result", tool_use_id: "call_2", content: "(interrupted)" },
  ]);
});
