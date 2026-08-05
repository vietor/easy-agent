import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/core/agent.js";
import { Conversation } from "../src/core/conversation.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSubAgentTool } from "../src/tools/sub-agent.js";
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

function stub(name: string, content: string, readOnly = false) {
  return {
    name,
    readOnly,
    description: name,
    parameters: { type: "object", properties: {} },
    async execute() {
      return content;
    },
  };
}

const SUB_TOOLS = [stub("FileRead", "file contents", true), stub("Glob", "matches", true), stub("Grep", "hits", true), stub("WebFetch", "web", true)];

function makeParentAgent(llm: LLMClient, subAgentOpts: { maxTurns?: number } = {}): Agent {
  const tools = new ToolRegistry();
  tools.registerAll(SUB_TOOLS);
  tools.register(stub("Shell", "ok"));
  tools.register(createSubAgentTool({ llm, registry: tools, ...subAgentOpts }));
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

  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg, "tool result must be in the conversation");
  assert.equal(toolMsg.content, "FOUND X");
  assert.ok(!toolMsg.isError);

  assert.match(String(calls[1].messages[0].content), /You are the Explore sub-agent/);
  assert.match(String(calls[1].messages[0].content), /Tool-Use Guidelines/);
  const nestedTools = calls[1].tools?.map((s) => s.function.name) ?? [];
  assert.deepEqual(nestedTools, ["FileRead", "Glob", "Grep", "WebFetch"]);
  assert.ok(!nestedTools.some((n) => ["SubAgent", "Shell", "FileWrite", "FileEdit", "Skill"].includes(n)));
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
  assert.equal(calls.length, 2);
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
  assert.ok(String(toolMsg.content).includes("max_turns"));
});

test("stalled sub-agent reports the repeated tool call in its result", async () => {
  const { llm } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "find X" })),
    () => toolCall("FileRead", JSON.stringify({ path: "a.ts" }), "n1"),
    () => toolCall("FileRead", JSON.stringify({ path: "a.ts" }), "n2"),
    () => toolCall("FileRead", JSON.stringify({ path: "a.ts" }), "n3"),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.equal(toolMsg.isError, true);
  assert.ok(String(toolMsg.content).includes("status stalled"));
  assert.ok(String(toolMsg.content).includes("repeated identical tool calls"));
  assert.ok(String(toolMsg.content).includes("FileRead"));
});

test("SubAgent tool type enum covers explore and plan", () => {
  const tool = createSubAgentTool({ llm: fakeLLM([]).llm, registry: new ToolRegistry() });
  const params = tool.parameters as { properties: { type: { enum: string[] } } };
  assert.deepEqual(params.properties.type.enum, ["explore", "plan"]);
});

test("multiple SubAgent calls in one turn run concurrently", async () => {
  let inflight = 0;
  let maxInflight = 0;
  let release: (() => void) | undefined;
  const bothRunning = new Promise<void>((r) => {
    release = r;
  });
  const calls: ChatOptions[] = [];
  const script: Array<() => AssistantMessage> = [
    () => ({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "s1", type: "function", function: { name: "SubAgent", arguments: JSON.stringify({ type: "explore", task: "task A" }) } },
        { id: "s2", type: "function", function: { name: "SubAgent", arguments: JSON.stringify({ type: "plan", task: "task B" }) } },
      ],
    }),
    () => ({ role: "assistant", content: "RESULT A" }),
    () => ({ role: "assistant", content: "RESULT B" }),
    () => ({ role: "assistant", content: "done" }),
  ];
  const llm: LLMClient = {
    model: "fake",
    reasoningEffort: "high",
    contextWindow: 200000,
    chat: async (opts) => {
      calls.push(opts);
      if (calls.length >= 2) {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        if (inflight === 2) release?.();
        await Promise.race([bothRunning, new Promise((r) => setTimeout(r, 500))]);
        inflight--;
      }
      const fn = script.shift();
      if (!fn) throw new Error("no scripted response");
      return fn(opts);
    },
  };
  const agent = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");
  assert.equal(maxInflight, 2);
  const results = agent.export().filter((m) => m.role === "tool" && !m.isError).map((m) => m.content);
  assert.ok(results.includes("RESULT A"));
  assert.ok(results.includes("RESULT B"));
});
