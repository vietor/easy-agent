import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { MCPServers } from "../src/mcp/server.js";
import { waitUntil } from "./helpers.js";
import type { SessionPersistence, SessionState } from "../src/core/types.js";
import type { AssistantMessage, ChatOptions, LLMClient } from "../src/llm/types.js";

function memoryPersistence(state: SessionState): SessionPersistence {
  return { load: async () => state, saveAll: async () => {}, listSessions: async () => [] };
}

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

function todoCall(todos: unknown, id: string): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name: "TodoWrite", arguments: JSON.stringify({ todos }) } }],
  };
}

function makeSession(script: Array<(opts: ChatOptions) => AssistantMessage>): Session {
  const tools = new ToolRegistry();
  return new Session({
    systemPrompt: "test",
    llm: fakeLLM(script),
    tools,
    mcp: new MCPServers(tools, { name: "test", version: "0" }),
    compactThreshold: 750_000,
    builtinTools: { todoWrite: true },
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

  await session.startPrompt("plan it");
  assert.equal(session.getSnapshot().todos.length, 0);

  await session.startPrompt("next");
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

  await session.startPrompt("plan it");
  await session.startPrompt("continue");
  assert.equal(session.getSnapshot().todos.length, 0);
});

test("restore replays persisted messages into the timeline", async () => {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute() { return "echoed"; },
    summaryArg: "path",
  });
  const state: SessionState = {
    messages: [
      { role: "user", content: "read x" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", type: "function", function: { name: "Echo", arguments: JSON.stringify({ path: "a/b" }) } }],
      },
      { role: "tool", tool_call_id: "t1", content: "echoed", isError: false, preview: "Echo 4 bytes" },
    ],
    todos: [],
  };
  const session = new Session({
    systemPrompt: "test",
    llm: fakeLLM([]),
    tools,
    mcp: new MCPServers(tools, { name: "test", version: "0" }),
    compactThreshold: 750_000,
    sessionId: "s1",
    persistence: memoryPersistence(state),
  });
  assert.equal(await session.restore(), true);
  assert.equal(session.export().length, 3);
  const timeline = session.getSnapshot().timeline;
  assert.equal(timeline.filter((e) => e.kind === "user").length, 1);
  const tool = timeline.find((e) => e.kind === "tool");
  assert.ok(tool && tool.kind === "tool");
  assert.equal(tool.name, "Echo");
  assert.equal(tool.summary, "a/b");
  assert.equal(tool.result, "echoed");
});

test("restore tolerates malformed persisted tool arguments", async () => {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute() { return "echoed"; },
    summaryArg: "path",
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
    mcp: new MCPServers(tools, { name: "test", version: "0" }),
    compactThreshold: 750_000,
    sessionId: "s1",
    persistence: memoryPersistence(state),
  });
  assert.equal(await session.restore(), true);
  const tool = session.getSnapshot().timeline.find((e) => e.kind === "tool");
  assert.ok(tool && tool.kind === "tool");
  assert.equal(tool.summary, "");
  assert.equal(tool.result, null);
});

test("builtinTools: false registers no built-in tools", async () => {
  const tools = new ToolRegistry();
  new Session({
    systemPrompt: "test",
    llm: fakeLLM([]),
    tools,
    mcp: new MCPServers(tools, { name: "test", version: "0" }),
    compactThreshold: 750_000,
    builtinTools: false,
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
  const first = await session.startPrompt("one");
  assert.equal(first.reply, "done");
  const second = await session.startPrompt("two");
  assert.equal(second.status, "error");
  assert.equal(second.reply, "");
});

test("abort keeps the partial reply but leaves it out of the timeline", async () => {
  const session = makeSession([
    (opts) => {
      opts.onDelta?.("partial reply");
      return new Promise<AssistantMessage>(() => {});
    },
  ]);
  session.subscribe(() => {});
  const run = session.startPrompt("go");
  assert.ok(await waitUntil(() => session.running, 5000), "run must start");
  session.abort();
  const { status, reply } = await run;
  assert.equal(status, "aborted");
  assert.equal(reply, "partial reply");
  const timeline = session.getSnapshot().timeline;
  assert.equal(timeline.filter((e) => e.kind === "assistant").length, 0);
  assert.ok(timeline.some((e) => e.kind === "interrupted"));
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
    mcp: new MCPServers(tools, { name: "test", version: "0" }),
    compactThreshold: 750_000,
    builtinTools: { askUser: true },
  });
  const run = session.startPrompt("go");
  assert.ok(await waitUntil(() => session.getPendingQuestion() !== undefined, 5000), "question must become pending");
  session.dispose();
  const { status } = await run;
  assert.equal(status, "aborted");
  assert.equal(session.getPendingQuestion(), undefined);
});
