import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { finalMessageError, stopReasonError, toAnthropicMessages } from "../src/llm/anthropic.js";
import { IncompleteStreamError, TruncatedResponseError } from "../src/llm/messages.js";

const IMAGE = { mimeType: "image/png", data: "aGk=" } as const;

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

test("an errored tool result is marked as an error", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Echo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "Error: boom", isError: true },
    ],
    true
  );
  assert.deepEqual(messages[2].content, [
    { type: "tool_result", tool_use_id: "call_1", content: "Error: boom", is_error: true },
  ]);
});

test("an image tool result renders as image blocks before the text", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "Read image f.png (image/png, 12 bytes)", images: [IMAGE] },
    ],
    true
  );
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[2].content, [
    {
      type: "tool_result",
      tool_use_id: "call_1",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
        { type: "text", text: "Read image f.png (image/png, 12 bytes)" },
      ],
    },
  ]);
});

test("an image tool result merges with a following plain tool result", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "Glob", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "image", images: [IMAGE] },
      { role: "tool", tool_call_id: "call_2", content: "fetched" },
    ],
    true
  );
  const idx = messages.findIndex((m) => m.role === "assistant");
  assert.deepEqual(messages[idx + 1].content, [
    {
      type: "tool_result",
      tool_use_id: "call_1",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
        { type: "text", text: "image" },
      ],
    },
    { type: "tool_result", tool_use_id: "call_2", content: "fetched" },
  ]);
  assert.equal(messages.length, idx + 2);
});

test("an image tool result stays separate from a following user text message", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "image", images: [IMAGE] },
      { role: "user", content: "<system-reminder>Tasks: ..." },
    ],
    true
  );
  const idx = messages.findIndex((m) => m.role === "assistant");
  assert.deepEqual(messages[idx + 1].content, [
    {
      type: "tool_result",
      tool_use_id: "call_1",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
        { type: "text", text: "image" },
      ],
    },
  ]);
  assert.equal(messages[idx + 2].content, "<system-reminder>Tasks: ...");
});

test("the cache breakpoint lands on a tool_result carrying image blocks", () => {
  const { messages } = toAnthropicMessages(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "image", images: [IMAGE] },
      { role: "user", content: "<system-reminder>Tasks: ..." },
    ],
    true,
    3
  );
  assert.deepEqual(messages[2].content, [
    {
      type: "tool_result",
      tool_use_id: "call_1",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
        { type: "text", text: "image" },
      ],
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ]);
  assert.equal(messages[messages.length - 1].content, "<system-reminder>Tasks: ...");
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
    { type: "tool_result", tool_use_id: "call_1", content: "echoed", cache_control: { type: "ephemeral", ttl: "1h" } },
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
    { role: "user", content: [{ type: "text", text: "go", cache_control: { type: "ephemeral", ttl: "1h" } }] },
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

test("truncated stop reasons map to a truncated error", () => {
  for (const reason of ["max_tokens", "model_context_window_exceeded", "pause_turn"]) {
    assert.ok(stopReasonError(reason) instanceof TruncatedResponseError, reason);
  }
  assert.equal(stopReasonError("end_turn"), null);
  assert.equal(stopReasonError("tool_use"), null);
  assert.ok(stopReasonError(null) instanceof IncompleteStreamError);
});

test("a stream ending without a complete message maps to an incomplete stream error", () => {
  const error = finalMessageError(new Anthropic.AnthropicError("stream ended without producing a Message with role=assistant"));
  assert.ok(error instanceof IncompleteStreamError);
  assert.equal(finalMessageError(new Anthropic.APIError(400, undefined, "bad request", undefined)), null);
  assert.equal(finalMessageError(new TypeError("fetch failed")), null);
});

