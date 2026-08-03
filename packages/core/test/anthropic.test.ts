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

test("tool results for a multi-tool_use assistant merge into one message", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "分步骤执行" },
      {
        role: "assistant",
        content: "第 1 步完成",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "TodoWrite", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "WebFetch", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "updated" },
      { role: "tool", tool_call_id: "call_2", content: "fetched" },
    ],
    true
  );
  const idx = messages.findIndex((m) => m.role === "assistant");
  assert.deepEqual(messages[idx + 1], {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "call_1", content: "updated" },
      { type: "tool_result", tool_use_id: "call_2", content: "fetched" },
    ],
  });
  assert.equal(messages.length, idx + 2);
});

test("a follow-up user text message stays separate from tool results", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Echo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "echoed" },
      { role: "user", content: "<system-reminder>Tasks: ..." },
    ],
    true
  );
  const idx = messages.findIndex((m) => m.role === "assistant");
  assert.deepEqual(messages[idx + 1].content, [{ type: "tool_result", tool_use_id: "call_1", content: "echoed" }]);
  assert.equal(messages[idx + 2].content, "<system-reminder>Tasks: ...");
});

test("partially satisfied tool_use appends the missing placeholder into the results message", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "Echo", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "Echo", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "echoed" },
    ],
    true
  );
  const idx = messages.findIndex((m) => m.role === "assistant");
  assert.deepEqual(messages[idx + 1].content, [
    { type: "tool_result", tool_use_id: "call_1", content: "echoed" },
    { type: "tool_result", tool_use_id: "call_2", content: "(interrupted)" },
  ]);
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
