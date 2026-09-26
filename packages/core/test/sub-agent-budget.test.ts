import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/runtime/agent.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSubAgentTool } from "../src/tools/sub-agent.js";
import { SubAgentBudget, runSubAgent } from "../src/runtime/sub-agent-runner.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient } from "../src/llm/types.js";

function fakeLLM(script: Array<(opts: ChatOptions) => LLMAssistantMessage>) {
  const calls: ChatOptions[] = [];
  const llm: LLMClient = {
    model: "fake",
    thinkingEffort: "high",
    maxInputTokens: 200000,
    maxOutputTokens: 128000,
    chat: async (opts) => {
      calls.push(opts);
      const fn = script.shift();
      if (!fn) throw new Error("no scripted response");
      return fn(opts);
    },
  };
  return { llm, calls };
}

function runOpts(llm: LLMClient, budget?: SubAgentBudget) {
  return {
    llm,
    tools: new ToolRegistry(),
    cwd: process.cwd(),
    sessionId: "s1",
    depth: 1,
    maxSubAgentDepth: 3,
    budget,
    maxTurns: 5,
    stallThreshold: 3,
    maxParallelToolCalls: 10,
    contextLimit: 750_000,
  };
}

function subAgentCalls(...tasks: string[]): LLMAssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: tasks.map((task, i) => ({
      id: `s${i}`,
      type: "function",
      function: { name: "SubAgent", arguments: JSON.stringify({ type: "explore", task }) },
    })),
  };
}

test("running at the limit is refused without calling the model", async () => {
  const budget = new SubAgentBudget(1);
  assert.equal(budget.tryAcquire(), true);
  const { llm, calls } = fakeLLM([]);
  await assert.rejects(runSubAgent(runOpts(llm, budget), "sys", "task", 1), /sub-agent limit reached/);
  assert.equal(calls.length, 0);
});

test("a run that ends badly releases its slot", async () => {
  const budget = new SubAgentBudget(1);
  const { llm } = fakeLLM([
    () => {
      throw new Error("model down");
    },
  ]);
  const result = await runSubAgent(runOpts(llm, budget), "sys", "task", 1);
  assert.notEqual(result.status, "ok");
  assert.equal(budget.tryAcquire(), true);
});

test("a run that succeeds releases its slot", async () => {
  const budget = new SubAgentBudget(1);
  const { llm } = fakeLLM([() => ({ role: "assistant", content: "DONE" })]);
  const result = await runSubAgent(runOpts(llm, budget), "sys", "task", 1);
  assert.equal(result.status, "ok");
  assert.equal(budget.tryAcquire(), true);
});

test("a delegation tree shares one budget", async () => {
  const budget = new SubAgentBudget(1);
  const { llm } = fakeLLM([
    () => subAgentCalls("first", "second"),
    () => ({ role: "assistant", content: "FIRST DONE" }),
    () => ({ role: "assistant", content: "parent done" }),
  ]);
  const tools = new ToolRegistry();
  tools.register(
    createSubAgentTool({
      runSubAgent: (systemPrompt, task, level, signal) =>
        runSubAgent(runOpts(llm, budget), systemPrompt, task, level, signal),
    })
  );
  const conversation = new SessionMessages("system prompt");
  const agent = new Agent({
    llm,
    conversation,
    tools,
    cwd: process.cwd(),
    getTodos: () => [],
    stallThreshold: 3,
    maxTurns: 5,
    maxParallelToolCalls: 10,
    contextLimit: 750_000,
  });
  await agent.run("go");
  const results = conversation.export().filter((m) => m.role === "tool");
  assert.equal(results.length, 2);
  assert.equal(results[0].content, "FIRST DONE");
  assert.equal(results[0].isError, undefined);
  assert.match(results[1].content, /sub-agent limit reached/);
  assert.equal(results[1].isError, true);
});
