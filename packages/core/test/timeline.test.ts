import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/core/agent.js";
import { Conversation } from "../src/core/conversation.js";
import { RunLoop } from "../src/core/runloop.js";
import { TimelineStore, TodoStore, messagesToSessionEvents } from "../src/core/timeline.js";
import type { TimelineEntry } from "../src/core/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { AssistantMessage, ChatOptions, LLMClient } from "../src/llm/types.js";

function fakeLLM(script: Array<(opts: ChatOptions) => AssistantMessage>) {
  const llm: LLMClient = {
    model: "fake",
    reasoningEffort: "high",
    contextWindow: 200000,
    chat: async (opts) => {
      const fn = script.shift();
      if (!fn) throw new Error("no scripted response");
      return fn(opts);
    },
  };
  return llm;
}

function toolCall(name: string, id = "t1"): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  };
}

function echoAgent(llm: LLMClient): Agent {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    async execute() {
      return "echoed";
    },
  });
  return new Agent({
    llm,
    conversation: new Conversation("system prompt"),
    tools,
    cwd: process.cwd(),
    setTodos: () => {},
    getTodos: () => [],
    stallThreshold: 3,
    maxTurns: 50,
    compactThreshold: 750_000,
  });
}

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

test("applyEvent translates every persisted event type into an entry", () => {
  const store = new TimelineStore();
  store.applyEvent({ type: "user", text: "hi" });
  store.applyEvent({ type: "skill", name: "s" });
  store.applyEvent({ type: "assistant", text: "hello" });
  store.applyEvent({ type: "retry", attempt: 2, max: 3 });
  store.applyEvent({ type: "notice", text: "n" });
  store.applyEvent({ type: "error", text: "e" });
  store.applyEvent({ type: "interrupted" });
  store.applyEvent({ type: "tool_start", id: "t1", name: "Echo", summary: "s" });
  store.applyEvent({ type: "tool_end", id: "t1", result: "out", isError: true, preview: "p" });
  // stream-only / state events must not create entries
  store.applyEvent({ type: "assistant_delta", text: "x" });
  store.applyEvent({ type: "reasoning_delta", text: "x" });
  store.applyEvent({ type: "reasoning_clear" });
  store.applyEvent({ type: "state", running: false, elapsed: 0, thinkingElapsed: 0, replyElapsed: 0, inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(store.all, [
    { kind: "user", text: "hi" },
    { kind: "skill", name: "s" },
    { kind: "assistant", text: "hello" },
    { kind: "retry", attempt: 2, max: 3 },
    { kind: "notice", text: "n" },
    { kind: "error", text: "e" },
    { kind: "interrupted" },
    { kind: "tool", id: "t1", name: "Echo", summary: "s", result: "out", isError: true, preview: "p" },
  ]);
});

test("restored timeline from persisted messages matches the live run (golden equivalence)", async () => {
  const llm = fakeLLM([() => toolCall("Echo"), () => ({ role: "assistant", content: null })]);
  const agent = echoAgent(llm);
  const live = new TimelineStore();
  const loop = new RunLoop(agent, live, new TodoStore(), () => {});
  await loop.startPrompt("go");
  // assistant replies are pure tool calls here (no streamed text), so both
  // timelines carry user + tool entries only
  const restored = new TimelineStore();
  for (const e of messagesToSessionEvents(agent.export(), () => "")) restored.applyEvent(e);
  assert.deepEqual(restored.all, live.all);
});

test("restoring a run with a hanging tool keeps result null until aborted", () => {
  const store = new TimelineStore();
  const events = messagesToSessionEvents(
    [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "Echo", arguments: "{}" } }] },
    ],
    () => ""
  );
  for (const e of events) store.applyEvent(e);
  const tool = store.all.find((e) => e.kind === "tool");
  assert.deepEqual(tool, { kind: "tool", id: "t1", name: "Echo", summary: "", result: null });
  store.abortPendingTools();
  assert.equal((store.all.find((e) => e.kind === "tool") as Extract<TimelineEntry, { kind: "tool" }>).result, "aborted");
});
