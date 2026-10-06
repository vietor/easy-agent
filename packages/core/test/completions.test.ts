import { test } from "node:test";
import assert from "node:assert/strict";
import { toCompletionsMessages } from "../src/llm/openai.js";

const IMAGE = { mimeType: "image/png", data: "aGk=" } as const;

test("a tool message without images passes through with isError stripped", () => {
  const messages = toCompletionsMessages([
    { role: "user", content: "go" },
    { role: "tool", tool_call_id: "call_1", content: "out", isError: true },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: "go" },
    { role: "tool", tool_call_id: "call_1", content: "out" },
  ]);
});

test("a tool image flushes as a user message after the tool message", () => {
  const messages = toCompletionsMessages([
    { role: "tool", tool_call_id: "call_1", content: "Read image f.png (image/png, 12 bytes)", images: [IMAGE] },
  ]);
  assert.deepEqual(messages, [
    { role: "tool", tool_call_id: "call_1", content: "Read image f.png (image/png, 12 bytes)" },
    { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }] },
  ]);
});

test("images from consecutive tool messages flush as one user message", () => {
  const messages = toCompletionsMessages([
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } },
        { id: "call_2", type: "function", function: { name: "Read", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "first", images: [IMAGE] },
    { role: "tool", tool_call_id: "call_2", content: "second", images: [IMAGE, IMAGE] },
    { role: "user", content: "thanks" },
  ]);
  const image = { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } };
  assert.deepEqual(messages, [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } },
        { id: "call_2", type: "function", function: { name: "Read", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "first" },
    { role: "tool", tool_call_id: "call_2", content: "second" },
    { role: "user", content: [image, image, image] },
    { role: "user", content: "thanks" },
  ]);
});

test("images pending at the end of the conversation still flush", () => {
  const messages = toCompletionsMessages([
    { role: "tool", tool_call_id: "call_1", content: "first", images: [IMAGE] },
    { role: "tool", tool_call_id: "call_2", content: "second", images: [IMAGE] },
  ]);
  assert.equal(messages.length, 3);
  assert.equal((messages[2] as { content: unknown[] }).content.length, 2);
});
