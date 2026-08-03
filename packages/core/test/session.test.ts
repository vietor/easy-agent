import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/core/session.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { MCPServers } from "../src/mcp/server.js";
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
      // the completed list is visible while the run is still going
      assert.equal(session.getSnapshot().todos.length, 2);
      return { role: "assistant", content: "all done" };
    },
    () => {
      // the second run's LLM call must not see the stale completed list
      assert.equal(session.getSnapshot().todos.length, 0);
      return { role: "assistant", content: "ok" };
    },
  ]);
  session.subscribe(() => {}); // like the TUI: active subscriber invalidates the view cache

  await session.startPrompt("plan it");
  // the completed list is dropped as soon as the run settles
  assert.equal(session.getSnapshot().todos.length, 0);

  await session.startPrompt("next");
  assert.equal(session.getSnapshot().todos.length, 0);
});

test("a completed list re-created mid-run is cleared when the run settles", async () => {
  const session = makeSession([
    () => todoCall([{ content: "a", status: "pending" }, { content: "b", status: "pending" }], "t1"),
    () => todoCall([{ content: "a", status: "completed" }, { content: "b", status: "completed" }], "t2"),
    () => ({ role: "assistant", content: "all done" }),
    // on the new prompt the model re-creates the same completed list from history
    () => todoCall([{ content: "a", status: "completed" }, { content: "b", status: "completed" }], "t3"),
    () => {
      // the re-created list is visible while the run is still going
      assert.equal(session.getSnapshot().todos.length, 2);
      return { role: "assistant", content: "ok" };
    },
  ]);
  session.subscribe(() => {});

  await session.startPrompt("plan it");
  await session.startPrompt("continue");
  // the completed list must not survive the run boundary
  assert.equal(session.getSnapshot().todos.length, 0);
});
