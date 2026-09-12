import { test } from "node:test";
import assert from "node:assert/strict";
import { toAnthropicMessages } from "../src/llm/anthropic.js";

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

test("the cacheable prefix is marked and the appended reminder is not", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Echo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "echoed" },
      { role: "user", content: "<system-reminder>Tasks: ..." },
    ],
    true,
    3
  );
  const toolResult = messages.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
  assert.deepEqual(toolResult?.content, [
    { type: "tool_result", tool_use_id: "call_1", content: "echoed", cache_control: { type: "ephemeral" } },
  ]);
  assert.equal(messages[messages.length - 1].content, "<system-reminder>Tasks: ...");
});

test("a reminder merged into the last user message leaves the prefix unmarked", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "user", content: "<system-reminder>Tasks: ..." },
    ],
    true,
    1
  );
  assert.deepEqual(messages, [{ role: "user", content: "go\n<system-reminder>Tasks: ..." }]);
});

test("tool call arguments render as parsed input", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Write", arguments: '{"path":"a.txt","content":"x"}' } }] },
    ],
    true
  );
  const block = messages[1].content[0] as { input: unknown };
  assert.deepEqual(block.input, { path: "a.txt", content: "x" });
});

test("a leading assistant message folded into the system keeps the prefix aligned", () => {
  const { system, messages } = toAnthropicMessages(
    [
      { role: "assistant", content: "Summary of conversation so far: ..." },
      { role: "user", content: "go" },
    ],
    true,
    2
  );
  assert.equal(system, "Summary of conversation so far: ...");
  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "go", cache_control: { type: "ephemeral" } }] },
  ]);
});

test("a long prefix is marked again every window", () => {
  const history = Array.from({ length: 20 }, (_, i) =>
    i % 2 === 0 ? { role: "user" as const, content: `u${i}` } : { role: "assistant" as const, content: `a${i}` }
  );
  const { messages } = toAnthropicMessages(history, true, history.length);
  const marked = messages
    .map((m, i) => (Array.isArray(m.content) && m.content.some((b) => "cache_control" in b) ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(marked, [4, 19]);
});

