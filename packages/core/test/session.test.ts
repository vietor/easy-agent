import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { MCPServers } from "../src/mcp/server.js";
import { waitUntil } from "./helpers.js";
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
