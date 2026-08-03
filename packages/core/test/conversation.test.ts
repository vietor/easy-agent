import { test } from "node:test";
import assert from "node:assert/strict";
import { Conversation } from "../src/core/conversation.js";

const SYS = "sys";

test("estimatedTokens tracks bytes/4 of added messages", () => {
  const c = new Conversation(SYS);
  c.add({ role: "user", content: "hello world" });
  assert.equal(c.getEstimatedTokens(), 1 + 3);
  c.add({ role: "assistant", content: "hi" });
  assert.equal(c.getEstimatedTokens(), 1 + 3 + 1);
});

test("toLLM maps roles and prepends the system message", () => {
  const c = new Conversation(SYS);
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
  const c = new Conversation(SYS);
  c.add({ role: "user", content: "a" });
  c.toLLM();
  c.add({ role: "user", content: "b" });
  const llm = c.toLLM();
  assert.equal(llm.length, 3);
  assert.equal(llm[2].content, "b");
});

test("snapshot/restore rolls back messages and token estimate", () => {
  const c = new Conversation(SYS);
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
  const c = new Conversation(SYS);
  c.add({ role: "user", content: "history" });
  c.compact("summary text");
  assert.equal(c.export().length, 1);
  assert.equal(c.export()[0].role, "assistant");
  assert.equal(c.getEstimatedTokens(), 1 + Math.round("summary text".length / 4));
});

test("collapseSkills replaces skill content and invalidates the LLM cache", () => {
  const c = new Conversation(SYS);
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
  const c = new Conversation(SYS);
  c.add({ role: "user", content: "a" });
  c.add({ role: "assistant", content: "b" });
  const exported = c.export();
  const tokens = c.getEstimatedTokens();
  const c2 = new Conversation(SYS);
  c2.import(exported);
  assert.equal(c2.export().length, 2);
  assert.equal(c2.getEstimatedTokens(), tokens);
  assert.equal(c2.toLLM().length, 3);
});
