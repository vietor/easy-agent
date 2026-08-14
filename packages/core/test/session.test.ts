import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, type SessionState } from "../src/runtime/session.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { MCPServerManager } from "../src/mcp/manager.js";
import { waitUntil } from "./helpers.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient } from "../src/llm/types.js";

function fakeLLM(script: Array<(opts: ChatOptions) => LLMAssistantMessage>) {
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

function todoCall(todos: unknown, id: string): LLMAssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name: "TodoWrite", arguments: JSON.stringify({ todos }) } }],
  };
}

function makeSession(script: Array<(opts: ChatOptions) => LLMAssistantMessage>): Session {
  const tools = new ToolRegistry();
  return new Session({
    systemPrompt: "test",
    llm: fakeLLM(script),
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
    builtInTools: { todoWrite: true },
  });
}

test("a new prompt clears the all-completed todo list from the session view", async () => {
  const session = makeSession([
    () => todoCall([{ content: "a", status: "pending" }, { content: "b", status: "pending" }], "t1"),
    () => todoCall([{ content: "a", status: "completed" }, { content: "b", status: "completed" }], "t2"),
    () => {
      assert.equal(session.getSnapshot().todos.length, 2);
      return { role: "assistant", content: "all done" };
    },
    () => {
      assert.equal(session.getSnapshot().todos.length, 0);
      return { role: "assistant", content: "ok" };
    },
  ]);
  session.subscribe(() => {});

  await session.prompt("plan it");
  assert.equal(session.getSnapshot().todos.length, 0);

  await session.prompt("next");
  assert.equal(session.getSnapshot().todos.length, 0);
});

test("a completed list re-created mid-run is cleared when the run settles", async () => {
  const session = makeSession([
    () => todoCall([{ content: "a", status: "pending" }, { content: "b", status: "pending" }], "t1"),
    () => todoCall([{ content: "a", status: "completed" }, { content: "b", status: "completed" }], "t2"),
    () => ({ role: "assistant", content: "all done" }),
    () => todoCall([{ content: "a", status: "completed" }, { content: "b", status: "completed" }], "t3"),
    () => {
      assert.equal(session.getSnapshot().todos.length, 2);
      return { role: "assistant", content: "ok" };
    },
  ]);
  session.subscribe(() => {});

  await session.prompt("plan it");
  await session.prompt("continue");
  assert.equal(session.getSnapshot().todos.length, 0);
});

test("importState replays messages into the timeline", () => {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute() { return { content: "echoed" }; },
    summaryKeys: ["path"],
  });
  const state: SessionState = {
    messages: [
      { role: "user", content: "read x" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", type: "function", function: { name: "Echo", arguments: JSON.stringify({ path: "a/b" }) } }],
      },
      { role: "tool", tool_call_id: "t1", content: "echoed", isError: false, resultSummary: "Echo 4 bytes" },
    ],
    todos: [],
  };
  const session = new Session({
    systemPrompt: "test",
    llm: fakeLLM([]),
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
    sessionId: "s1",
  });
  session.importState(state);
  assert.equal(session.export().length, 3);
  const timeline = session.getSnapshot().timeline;
  assert.equal(timeline.filter((e) => e.type === "user").length, 1);
  const tool = timeline.find((e) => e.type === "tool");
  assert.ok(tool && tool.type === "tool");
  assert.equal(tool.name, "Echo");
  assert.equal(tool.argsSummary, "a/b");
  assert.equal(tool.result, "echoed");
});

test("importState tolerates malformed persisted tool arguments", () => {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute() { return { content: "echoed" }; },
    summaryKeys: ["path"],
  });
  const state: SessionState = {
    messages: [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", type: "function", function: { name: "Echo", arguments: "null" } }],
      },
    ],
    todos: [],
  };
  const session = new Session({
    systemPrompt: "test",
    llm: fakeLLM([]),
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
    sessionId: "s1",
  });
  session.importState(state);
  const tool = session.getSnapshot().timeline.find((e) => e.type === "tool");
  assert.ok(tool && tool.type === "tool");
  assert.equal(tool.argsSummary, "");
  assert.equal(tool.result, "(interrupted)");
});

test("a restored session with dangling tool calls is healed before the next run", async () => {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: "echoed" }; },
  });
  const state: SessionState = {
    messages: [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", type: "function", function: { name: "Echo", arguments: "{}" } }],
      },
    ],
    todos: [],
  };
  const session = new Session({
    systemPrompt: "test",
    llm: fakeLLM([
      (opts) => {
        assert.deepEqual(
          opts.messages.find((m) => m.role === "tool"),
          { role: "tool", tool_call_id: "t1", content: "(interrupted)" }
        );
        return { role: "assistant", content: "done" };
      },
    ]),
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
    sessionId: "s1",
  });
  session.importState(state);
  const { status } = await session.prompt("continue");
  assert.equal(status, "ok");
});

test("builtInTools: false registers no built-in tools", async () => {
  const tools = new ToolRegistry();
  new Session({
    systemPrompt: "test",
    llm: fakeLLM([]),
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
    builtInTools: false,
  });
  assert.equal(tools.schemas().length, 0);
});

test("a run that settles without streaming text returns an empty reply, not the previous run's", async () => {
  const session = makeSession([
    (opts) => {
      opts.onDelta?.("done");
      return { role: "assistant", content: "done" };
    },
    () => {
      throw new Error("boom");
    },
  ]);
  session.subscribe(() => {});
  const first = await session.prompt("one");
  assert.equal(first.reply, "done");
  const second = await session.prompt("two");
  assert.equal(second.status, "error");
  assert.equal(second.reply, "");
});

test("abort keeps the partial reply but leaves it out of the timeline", async () => {
  const session = makeSession([
    (opts) => {
      opts.onDelta?.("partial reply");
      return new Promise<LLMAssistantMessage>(() => {});
    },
  ]);
  session.subscribe(() => {});
  const run = session.prompt("go");
  assert.ok(await waitUntil(() => session.running, 5000), "run must start");
  session.abort();
  const { status, reply } = await run;
  assert.equal(status, "aborted");
  assert.equal(reply, "partial reply");
  const timeline = session.getSnapshot().timeline;
  assert.equal(timeline.filter((e) => e.type === "assistant").length, 0);
  assert.ok(timeline.some((e) => e.type === "interrupted"));
});

test("dispose resolves a pending question", async () => {
  const tools = new ToolRegistry();
  const session = new Session({
    systemPrompt: "test",
    llm: fakeLLM([
      () => ({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "q1", type: "function", function: { name: "AskUser", arguments: JSON.stringify({ question: "which?", options: ["a", "b"] }) } }],
      }),
    ]),
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
    builtInTools: { askUser: true },
  });
  const run = session.prompt("go");
  assert.ok(await waitUntil(() => session.pendingQuestion !== undefined, 5000), "question must become pending");
  session.dispose();
  const { status } = await run;
  assert.equal(status, "aborted");
  assert.equal(session.pendingQuestion, undefined);
});
