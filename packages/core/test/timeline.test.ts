import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/runtime/session.js";
import { TimelineStore, messagesToTimelineEntries } from "../src/runtime/timeline.js";
import { TodoStore } from "../src/runtime/todo-store.js";
import type { TimelineEvent } from "../src/runtime/events.js";
import { MCPServers } from "../src/mcp/server.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { AssistantMessage, ChatOptions, LLMClient } from "../src/llm/types.js";

function fakeLLM(script: Array<(opts: ChatOptions) => AssistantMessage>) {
  const llm: LLMClient = {
    model: "fake",
    thinkingEffort: "high",
    maxInputTokens: 200000,
    maxOutputTokens: 128000,
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

test("setAnswer is a no-op for an unknown question id", () => {
  const store = new TimelineStore();
  store.setAnswer("q1", "yes");
  assert.equal(store.all.length, 0);
});

test("setResult only mutates entries still pending", () => {
  const store = new TimelineStore();
  store.append({ type: "tool", id: "t1", name: "FileRead", argsSummary: "x", result: null });
  store.setResult("t1", "ok");
  store.setResult("t1", "again");
  assert.deepEqual(store.all, [{ type: "tool", id: "t1", name: "FileRead", argsSummary: "x", result: "ok", isError: undefined, resultSummary: undefined }]);
});

test("setAnswer records the answer on the question entry", () => {
  const store = new TimelineStore();
  store.applyEvent({ type: "question", id: "q1", text: "pick", options: ["a", "b"] });
  store.setAnswer("q1", "b");
  assert.deepEqual(store.all, [{ type: "question", id: "q1", text: "pick", options: ["a", "b"], answer: "b" }]);
});

test("latestUnansweredQuestion tracks the most recent unanswered question", () => {
  const store = new TimelineStore();
  assert.equal(store.latestUnansweredQuestion, undefined);
  store.applyEvent({ type: "question", id: "q1", text: "one", options: [] });
  store.applyEvent({ type: "question", id: "q2", text: "two", options: [] });
  assert.equal(store.latestUnansweredQuestion?.id, "q2");
  store.setAnswer("q2", "yes");
  assert.equal(store.latestUnansweredQuestion?.id, "q1");
  store.setAnswer("q1", "yes");
  assert.equal(store.latestUnansweredQuestion, undefined);
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
  store.applyEvent({ type: "retry", attempt: 2, max: 3, reason: "429 rate limited" });
  store.applyEvent({ type: "notice", text: "n" });
  store.applyEvent({ type: "error", text: "e" });
  store.applyEvent({ type: "interrupted" });
  store.applyEvent({ type: "tool_start", id: "t1", name: "Echo", argsSummary: "s" });
  store.applyEvent({ type: "tool_end", id: "t1", result: "out", isError: true, resultSummary: "p" });
  store.applyEvent({ type: "assistant_delta", text: "x" });
  store.applyEvent({ type: "thinking_delta", text: "x" });
  store.applyEvent({ type: "thinking_clear" });
  store.applyEvent({ type: "run_stats", running: false, elapsed: 0, thinkingElapsed: 0, replyElapsed: 0, inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(store.all, [
    { type: "user", text: "hi" },
    { type: "skill", name: "s" },
    { type: "assistant", text: "hello" },
    { type: "retry", attempt: 2, max: 3, reason: "429 rate limited" },
    { type: "notice", text: "n" },
    { type: "error", text: "e" },
    { type: "interrupted" },
    { type: "tool", id: "t1", name: "Echo", argsSummary: "s", result: "out", isError: true, resultSummary: "p" },
  ]);
});

test("restored timeline from persisted messages matches the live run (golden equivalence)", async () => {
  const llm = fakeLLM([() => toolCall("Echo"), () => ({ role: "assistant", content: null })]);
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: "echoed" };
    },
  });
  const session = new Session({
    systemPrompt: "test",
    llm,
    tools,
    mcp: new MCPServers(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
  });
  session.subscribe(() => {});
  const result = await session.prompt("go");
  assert.equal(result.status, "ok");
  const live = session.getSnapshot().timeline;
  const restored = new TimelineStore();
  restored.rebuild(messagesToTimelineEntries(session.export(), () => ""));
  assert.deepEqual(restored.all, live);
});

test("restoring a run with a hanging tool keeps result null until aborted", () => {
  const store = new TimelineStore();
  store.rebuild(
    messagesToTimelineEntries(
      [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "Echo", arguments: "{}" } }] },
      ],
      () => ""
    )
  );
  const tool = store.all.find((e) => e.type === "tool");
  assert.deepEqual(tool, { type: "tool", id: "t1", name: "Echo", argsSummary: "", result: null });
  store.markPendingToolsAborted();
  assert.equal((store.all.find((e) => e.type === "tool") as Extract<TimelineEvent, { type: "tool" }>).result, "aborted");
});
