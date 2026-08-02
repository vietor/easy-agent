import { test } from "node:test";
import assert from "node:assert/strict";
import { TimelineStore, TodoStore } from "../src/core/timeline.js";

test("setAnswer returns false for an unknown question id", () => {
  const store = new TimelineStore();
  assert.equal(store.setAnswer("q1", "yes"), false);
  assert.equal(store.all.length, 0);
});

test("setResult only mutates entries still pending", () => {
  const store = new TimelineStore();
  store.append({ kind: "tool", id: "t1", name: "FileRead", summary: "x", result: null });
  store.setResult("t1", "ok");
  store.setResult("t1", "again"); // already resolved: must be a no-op
  assert.deepEqual(store.all, [{ kind: "tool", id: "t1", name: "FileRead", summary: "x", result: "ok", isError: undefined, preview: undefined }]);
});

test("appendQuestion registers a resolver that setAnswer resolves", () => {
  const store = new TimelineStore();
  let resolved: string | undefined;
  store.appendQuestion({ id: "q1", text: "pick", options: ["a", "b"] }, (a) => { resolved = a; });
  assert.equal(store.setAnswer("q1", "b"), true);
  assert.equal(resolved, "b");
  assert.deepEqual(store.all, [{ kind: "question", id: "q1", text: "pick", options: ["a", "b"], answer: "b" }]);
});

test("resolveAllAnswers resolves every pending question and returns ids", () => {
  const store = new TimelineStore();
  const answers: string[] = [];
  store.appendQuestion({ id: "q1", text: "one", options: [] }, (a) => answers.push(a));
  store.appendQuestion({ id: "q2", text: "two", options: [] }, (a) => answers.push(a));
  const ids = store.resolveAllAnswers("");
  assert.deepEqual([...ids].sort(), ["q1", "q2"]);
  assert.deepEqual(answers, ["", ""]);
  assert.equal(store.setAnswer("q1", "x"), false); // nothing left pending
});

test("a throwing listener does not break other listeners", () => {
  const store = new TodoStore();
  const events: string[] = [];
  store.subscribe(() => { throw new Error("boom"); });
  store.subscribe(() => { events.push("second"); });
  assert.doesNotThrow(() => store.set([{ content: "t", status: "pending" }]));
  assert.deepEqual(events, ["second"]);
});
