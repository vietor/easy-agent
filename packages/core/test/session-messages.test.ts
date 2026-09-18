import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionMessages } from "../src/runtime/session-messages.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import { INTERRUPTED_TOOL_CONTENT, PRUNE_MIN_CLEAR_RATIO } from "../src/util/constants.js";

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
  const skillContent = 'Skill "s" invoked. Its instructions follow:\n\ninstructions';
  assert.deepEqual(llm[3], { role: "user", name: "s", content: skillContent });
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

test("skillMessage keeps the prompt the first time and only notes it afterwards", () => {
  const c = new SessionMessages(SYS);
  const first = c.skillMessage("test-skill", "do X and Y and Z");
  assert.equal(first.content, "do X and Y and Z");
  c.add(first);
  const second = c.skillMessage("test-skill", "do X and Y and Z");
  assert.equal(second.role, "skill");
  assert.equal(second.content, '<skill "test-skill" invoked - its instructions are already in context above>');
});

test("skillMessage distinguishes by name and by content", () => {
  const c = new SessionMessages(SYS);
  c.add(c.skillMessage("a", "instructions"));
  assert.equal(c.skillMessage("b", "instructions").content, "instructions");
  assert.equal(c.skillMessage("a", "other instructions").content, "other instructions");
});

test("skillMessage reloads the prompt after the conversation is compacted", () => {
  const c = new SessionMessages(SYS);
  c.add(c.skillMessage("test-skill", "do X and Y and Z"));
  c.compact("summary");
  assert.equal(c.skillMessage("test-skill", "do X and Y and Z").content, "do X and Y and Z");
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

function addToolOutput(c: SessionMessages, id: string, chars: number, summary?: string): void {
  c.add({ role: "tool", tool_call_id: id, content: "a".repeat(chars), resultSummary: summary });
}

test("pruneToolOutputs clears old tool output, protects the recent window, and fixes token accounting", () => {
  const c = new SessionMessages(SYS);
  for (const id of ["t1", "t2", "t3", "t4"]) addToolOutput(c, id, 100_000, "Command executed 100000 bytes");
  c.createSnapshot();
  c.toLLM();
  const before = c.getEstimatedTokens();

  const freed = c.pruneToolOutputs(PRUNE_MIN_CLEAR_RATIO * before);
  assert.ok(freed > PRUNE_MIN_CLEAR_RATIO * before, "prune must report the tokens it freed");
  assert.equal(c.getEstimatedTokens(), before - freed);

  const msgs = c.export();
  assert.match(msgs[0].content, /^\(output cleared: Command executed 100000 bytes\)$/);
  assert.match(msgs[2].content, /^\(output cleared: /);
  assert.equal(msgs[3].content, "a".repeat(100_000), "the most recent tool output must survive");
  assert.equal(c.toLLM()[1].content, msgs[0].content, "the LLM cache must be rebuilt");

  c.restoreFromSnapshot();
  assert.equal(c.getEstimatedTokens(), before - freed, "snapshot tokens must stay in sync");
});

test("pruneToolOutputs leaves history intact when the reclaimable amount is below the minimum", () => {
  const c = new SessionMessages(SYS);
  for (let i = 0; i < 10; i++) addToolOutput(c, `t${i}`, 4_000);
  const before = c.getEstimatedTokens();

  assert.equal(c.pruneToolOutputs(0.5 * before), 0);
  assert.equal(c.getEstimatedTokens(), before);
  assert.equal(c.export()[0].content, "a".repeat(4_000));
});
