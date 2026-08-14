import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionMessages } from "../src/runtime/session-messages.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import { INTERRUPTED_TOOL_CONTENT } from "../src/util/constants.js";

const SYS = "sys";

function assistantToolCall(id: string): LLMAssistantMessage {
  return { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "Echo", arguments: "{}" } }] };
}

test("estimatedTokens tracks bytes/4 of added messages", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "hello world" });
  assert.equal(c.getEstimatedTokens(), 1 + 3);
  c.add({ role: "assistant", content: "hi" });
  assert.equal(c.getEstimatedTokens(), 1 + 3 + 1);
});

test("toLLM maps roles and prepends the system message", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "hi" });
  c.add({ role: "tool", tool_call_id: "t1", content: "out" });
  c.add({ role: "skill", name: "s", content: "instructions" });
  const llm = c.toLLM();
  assert.equal(llm.length, 4);
  assert.deepEqual(llm[0], { role: "system", content: SYS });
  assert.deepEqual(llm[2], { role: "tool", tool_call_id: "t1", content: "out" });
  assert.deepEqual(llm[3], { role: "user", name: "s", content: "instructions" });
});

test("toLLM cache stays in sync with add", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "a" });
  c.toLLM();
  c.add({ role: "user", content: "b" });
  const llm = c.toLLM();
  assert.equal(llm.length, 3);
  assert.equal(llm[2].content, "b");
});

test("snapshot/restore rolls back messages and token estimate", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "a" });
  c.createSnapshot();
  c.add({ role: "user", content: "b" });
  c.add({ role: "assistant", content: "reply" });
  c.toLLM();
  c.restoreFromSnapshot();
  assert.equal(c.export().length, 1);
  assert.equal(c.export()[0].content, "a");
  assert.equal(c.getEstimatedTokens(), 1);
  c.add({ role: "user", content: "c" });
  assert.equal(c.export().length, 2);
  assert.equal(c.toLLM().length, 3);
});

test("compact replaces the conversation with the summary", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "history" });
  c.compact("summary text");
  assert.equal(c.export().length, 1);
  assert.equal(c.export()[0].role, "assistant");
  assert.equal(c.getEstimatedTokens(), 1 + Math.round("summary text".length / 4));
});

test("collapseSkills replaces skill content and invalidates the LLM cache", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "skill", name: "test-skill", content: "do X and Y and Z" });
  const before = c.getEstimatedTokens();
  c.toLLM();
  c.collapseSkills();
  const m = c.export()[0];
  assert.equal(m.role, "skill");
  assert.equal(
    m.content,
    '<skill "test-skill" invoked - its instructions were followed above>'
  );
  const collapsed = c.export()[0].content as string;
  assert.equal(c.getEstimatedTokens(), before - Math.round("do X and Y and Z".length / 4) + Math.round(collapsed.length / 4));
  const llm = c.toLLM();
  assert.ok((llm[1].content as string).includes("its instructions were followed above"));
});

test("import restores messages and token estimate", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "a" });
  c.add({ role: "assistant", content: "b" });
  const exported = c.export();
  const tokens = c.getEstimatedTokens();
  const c2 = new SessionMessages(SYS);
  c2.import(exported);
  assert.equal(c2.export().length, 2);
  assert.equal(c2.getEstimatedTokens(), tokens);
  assert.equal(c2.toLLM().length, 3);
});

test("normalizeInterruptedToolCalls appends a placeholder for a dangling tool call", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "go" });
  c.add(assistantToolCall("t1"));
  c.normalizeInterruptedToolCalls();
  assert.deepEqual(c.export(), [
    { role: "user", content: "go" },
    assistantToolCall("t1"),
    { role: "tool", tool_call_id: "t1", content: INTERRUPTED_TOOL_CONTENT },
  ]);
});

test("normalizeInterruptedToolCalls inserts the placeholder before the next non-tool message", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "go" });
  c.add(assistantToolCall("t1"));
  c.add({ role: "user", content: "next" });
  c.normalizeInterruptedToolCalls();
  const msgs = c.export();
  assert.equal(msgs[2].role, "tool");
  assert.equal((msgs[2] as { tool_call_id: string }).tool_call_id, "t1");
  assert.equal(msgs[3].content, "next");
});

test("normalizeInterruptedToolCalls leaves satisfied tool calls untouched", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "go" });
  c.add(assistantToolCall("t1"));
  c.add({ role: "tool", tool_call_id: "t1", content: "echoed" });
  c.normalizeInterruptedToolCalls();
  assert.equal(c.export().length, 3);
});

test("normalizeInterruptedToolCalls appends only the missing placeholder after real results", () => {
  const c = new SessionMessages(SYS);
  c.add({
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "t1", type: "function", function: { name: "Echo", arguments: "{}" } },
      { id: "t2", type: "function", function: { name: "Echo", arguments: "{}" } },
    ],
  });
  c.add({ role: "tool", tool_call_id: "t1", content: "echoed" });
  c.normalizeInterruptedToolCalls();
  const msgs = c.export();
  assert.deepEqual(msgs.map((m) => m.role), ["assistant", "tool", "tool"]);
  assert.deepEqual(msgs[msgs.length - 1], { role: "tool", tool_call_id: "t2", content: INTERRUPTED_TOOL_CONTENT });
});

test("normalizeInterruptedToolCalls handles consecutive dangling assistant messages", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "go" });
  c.add(assistantToolCall("t1"));
  c.add(assistantToolCall("t2"));
  c.normalizeInterruptedToolCalls();
  const msgs = c.export();
  assert.deepEqual(msgs[2], { role: "tool", tool_call_id: "t1", content: INTERRUPTED_TOOL_CONTENT });
  assert.deepEqual(msgs[4], { role: "tool", tool_call_id: "t2", content: INTERRUPTED_TOOL_CONTENT });
});

test("normalizeInterruptedToolCalls updates tokens and invalidates the LLM cache", () => {
  const c = new SessionMessages(SYS);
  c.add({ role: "user", content: "go" });
  c.add(assistantToolCall("t1"));
  const before = c.getEstimatedTokens();
  c.toLLM();
  c.normalizeInterruptedToolCalls();
  assert.equal(c.getEstimatedTokens(), before + Math.round(INTERRUPTED_TOOL_CONTENT.length / 4));
  assert.deepEqual(c.toLLM()[c.toLLM().length - 1], { role: "tool", tool_call_id: "t1", content: INTERRUPTED_TOOL_CONTENT });
});

test("import normalizes dangling tool calls", () => {
  const c = new SessionMessages(SYS);
  c.import([{ role: "user", content: "go" }, assistantToolCall("t1")]);
  assert.deepEqual(c.export()[2], { role: "tool", tool_call_id: "t1", content: INTERRUPTED_TOOL_CONTENT });
});
