import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/core/agent.js";
import { Conversation } from "../src/core/conversation.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSubAgentTool } from "../src/tools/subAgent.js";
import type { AssistantMessage, ChatOptions, LLMClient } from "../src/llm/types.js";

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

function stub(name: string, content: string) {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    async execute() {
      return content;
    },
  };
}

function makeParentAgent(llm: LLMClient, subAgentOpts: { maxTurns?: number } = {}): Agent {
  const tools = new ToolRegistry();
  tools.register(stub("FileRead", "file contents"));
  tools.register(stub("Glob", "matches"));
  tools.register(stub("Grep", "hits"));
  tools.register(stub("WebFetch", "web"));
  tools.register(stub("Shell", "ok"));
  tools.register(createSubAgentTool({ llm, tools, ...subAgentOpts }));
  const conversation = new Conversation("system prompt");
  return new Agent({
    llm,
    conversation,
    tools,
    cwd: process.cwd(),
    setTodos: () => {},
    getTodos: () => [],
    stallThreshold: 3,
    maxTurns: 50,
    compactThreshold: 750_000,
  });
}

test("nested sub-agent report becomes the SubAgent tool result", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "find X" })),
    () => toolCall("FileRead", JSON.stringify({ path: "a.ts" }), "n1"),
    () => ({ role: "assistant", content: "FOUND X" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  // parent conversation records the nested report as the tool result
  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg, "tool result must be in the conversation");
  assert.equal(toolMsg.content, "FOUND X");
  assert.ok(!toolMsg.isError);

  // nested loop: system prompt, restricted tool set, tool result fed back
  assert.match(String(calls[1].messages[0].content), /You are the Explore sub-agent/);
  assert.match(String(calls[1].messages[0].content), /Tool-Use Guidelines/);
  const nestedTools = calls[1].tools?.map((s) => s.function.name) ?? [];
  assert.deepEqual(nestedTools, ["FileRead", "Glob", "Grep", "WebFetch", "Shell"]);
  assert.ok(!nestedTools.some((n) => ["SubAgent", "FileWrite", "FileEdit", "Skill"].includes(n)));
  assert.ok(
    calls[2].messages.some(
      (m) => m.role === "tool" && typeof m.content === "string" && m.content.includes("file contents")
    )
  );
});

test("unknown sub-agent type returns an error without invoking a nested loop", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "bogus", task: "x" })),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.equal(toolMsg.isError, true);
  assert.ok(String(toolMsg.content).includes("bogus"));
  assert.equal(calls.length, 2); // parent only — the nested loop never ran
});

test("nested maxTurns is enforced", async () => {
  const { llm } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "plan", task: "plan X" })),
    () => toolCall("FileRead", JSON.stringify({ path: "a.ts" }), "n1"),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeParentAgent(llm, { maxTurns: 1 });
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.equal(toolMsg.isError, true);
  assert.ok(String(toolMsg.content).includes("maxturns"));
});
