import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent, type AgentEvent } from "../src/core/agent.js";
import { Conversation } from "../src/core/conversation.js";
import { RunLoop } from "../src/core/runloop.js";
import { TimelineStore, TodoStore } from "../src/core/timeline.js";
import type { SessionEvent } from "../src/core/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { AssistantMessage, ChatOptions, LLMClient, Message } from "../src/llm/types.js";
import type { Todo } from "../src/tools/types.js";

function fakeLLM(script: Array<(opts: ChatOptions) => AssistantMessage>) {
  const calls: ChatOptions[] = [];
  const llm: LLMClient = {
    model: "fake",
    reasoningEffort: "high",
    contextWindow: 200000,
    chat: async (opts) => {
      calls.push(opts);
      const fn = script.shift();
      if (!fn) throw new Error("no scripted response");
      return fn(opts);
    },
  };
  return { llm, calls };
}

function toolCall(name: string, args = "{}", id = "t1"): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}

function makeAgent(
  llm: LLMClient,
  opts: { maxTurns?: number; compactThreshold?: number; getTodos?: () => readonly Todo[] } = {}
): Agent {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    async execute() {
      return "echoed";
    },
  });
  const conversation = new Conversation("system prompt");
  return new Agent({
    llm,
    conversation,
    tools,
    cwd: process.cwd(),
    setTodos: () => {},
    getTodos: opts.getTodos ?? (() => []),
    stallThreshold: 3,
    maxTurns: opts.maxTurns ?? 50,
    compactThreshold: opts.compactThreshold ?? 750_000,
  });
}

function textContent(m: Message): string {
  return typeof m.content === "string" ? m.content : m.content?.map((p) => p.text).join("") ?? "";
}

test("text-only response completes with ok", async () => {
  const { llm } = fakeLLM([() => ({ role: "assistant", content: "done" })]);
  const agent = makeAgent(llm);
  const status = await agent.run("hi");
  assert.equal(status, "ok");
  assert.equal(agent.export().length, 2); // user + assistant
});

test("tool call executes and its result is stored in the conversation", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => ({ role: "assistant", content: "done" })]);
  const agent = makeAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");
  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg, "tool result must be in the conversation");
  assert.equal(toolMsg.content, "echoed");
});

test("stalls on repeated identical tool calls", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => toolCall("Echo"), () => toolCall("Echo")]);
  const agent = makeAgent(llm);
  const status = await agent.run("do it");
  assert.equal(status, "stalled");
});

test("text-only stall with incomplete todos: nudge is sent but never stored", async () => {
  const { llm, calls } = fakeLLM([
    () => ({ role: "assistant", content: "thinking..." }),
    () => ({ role: "assistant", content: "still thinking" }),
    () => ({ role: "assistant", content: "done-ish" }),
  ]);
  const agent = makeAgent(llm, { getTodos: () => [{ content: "t", status: "pending" }] });
  const status = await agent.run("work");
  assert.equal(status, "stalled");
  // nudge must reach the next request but never the persisted conversation
  const texts = agent.export().map((m) => (typeof m.content === "string" ? m.content : ""));
  assert.ok(!texts.some((t) => t.includes("STOP!")));
  assert.ok(calls[1].messages.some((m) => m.role === "user" && textContent(m).includes("STOP!")));
});

test("maxturns aborts after the configured limit of tool-call turns", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => toolCall("Echo")]);
  const agent = makeAgent(llm, { maxTurns: 2 });
  const status = await agent.run("go");
  assert.equal(status, "maxturns");
});

test("abort rolls the conversation back to the pre-run snapshot", async () => {
  const controller = new AbortController();
  const { llm } = fakeLLM([
    () => {
      controller.abort();
      return { role: "assistant", content: "partial" };
    },
  ]);
  const agent = makeAgent(llm);
  const status = await agent.run("go", undefined, controller.signal);
  assert.equal(status, "aborted");
  // user message remains (snapshot is taken after adding it), partial reply is rolled back
  assert.equal(agent.export().length, 1);
  assert.equal(agent.export()[0].content, "go");
});

test("aborted run resolves hanging tool entries in the timeline", async () => {
  const timeline = new TimelineStore();
  const todos = new TodoStore();
  const events: SessionEvent[] = [];
  const fakeAgent = {
    run: async (_text: string, onEvent?: (e: AgentEvent) => void) => {
      // tool starts but no tool_end follows, as when the run is aborted mid-call
      onEvent?.({ type: "tool_start", id: "t1", name: "Echo", summary: "" });
      return "aborted";
    },
  } as unknown as Agent;
  const loop = new RunLoop(fakeAgent, timeline, todos, (e) => events.push(e));
  await loop.startPrompt("go");
  const tool = timeline.all.find((e) => e.kind === "tool");
  assert.ok(tool && tool.kind === "tool");
  assert.equal(tool.result, "aborted");
  assert.equal(tool.isError, true);
});

test("auto-compact fires above the threshold and the run continues", async () => {
  const { llm, calls } = fakeLLM([
    (opts) => {
      const hasPrompt = opts.messages.some((m) => textContent(m).includes("Summarize the conversation above"));
      assert.ok(hasPrompt, "first call must be the compaction request");
      return { role: "assistant", content: "SUMMARY" };
    },
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeAgent(llm, { compactThreshold: 1000 });
  const status = await agent.run("a".repeat(5000)); // 5000 bytes -> 1250 tokens > 1000
  assert.equal(status, "ok");
  assert.deepEqual(agent.export().map((m) => m.content), ["SUMMARY", "done"]);
});
