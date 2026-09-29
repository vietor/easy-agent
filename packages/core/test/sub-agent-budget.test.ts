import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/runtime/agent.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSubAgentTool } from "../src/tools/sub-agent.js";
import { SubAgentBudget, runSubAgent } from "../src/runtime/sub-agent-runner.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { LLMClient } from "../src/llm/types.js";
import { fakeLLM } from "./helpers.js";

function runOpts(llm: LLMClient, budget?: SubAgentBudget) {
  return {
    llm,
    tools: new ToolRegistry(),
    cwd: process.cwd(),
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

async function runTurn(llm: LLMClient, budget: SubAgentBudget, depth = 1) {
  const tools = new ToolRegistry();
  tools.register(
    createSubAgentTool({
      runSubAgent: (systemPrompt, task, level, signal) =>
        runSubAgent({ ...runOpts(llm, budget), depth }, systemPrompt, task, level, signal),
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
  return conversation.export().filter((m) => m.role === "tool");
}

test("a nested run at the limit is refused without calling the model", async () => {
  const budget = new SubAgentBudget(1);
  assert.equal(budget.tryAcquire(), true);
  const { llm, calls } = fakeLLM([]);
  await assert.rejects(runSubAgent({ ...runOpts(llm, budget), depth: 2 }, "sys", "task", 1), /sub-agent limit reached/);
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
  const results = await runTurn(llm, budget, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].content, "FIRST DONE");
  assert.equal(results[0].isError, undefined);
  assert.match(results[1].content, /sub-agent limit reached/);
  assert.equal(results[1].isError, true);
});

test("top-level calls beyond the budget wait for a slot and all report in the same turn", async () => {
  const budget = new SubAgentBudget(4);
  const { llm, calls } = fakeLLM([
    () => subAgentCalls("a", "b", "c", "d", "e", "f"),
    () => ({ role: "assistant", content: "A DONE" }),
    () => ({ role: "assistant", content: "B DONE" }),
    () => ({ role: "assistant", content: "C DONE" }),
    () => ({ role: "assistant", content: "D DONE" }),
    () => ({ role: "assistant", content: "E DONE" }),
    () => ({ role: "assistant", content: "F DONE" }),
    () => ({ role: "assistant", content: "parent done" }),
  ]);
  const results = await runTurn(llm, budget);
  assert.deepEqual(results.map((m) => m.content), ["A DONE", "B DONE", "C DONE", "D DONE", "E DONE", "F DONE"]);
  assert.ok(results.every((m) => m.isError === undefined));
  assert.equal(calls.length, 8);
});

test("queued calls are skipped once a sub-agent in the turn fails", async () => {
  const budget = new SubAgentBudget(2);
  const { llm, calls } = fakeLLM([
    () => subAgentCalls("a", "b", "c", "d"),
    () => {
      throw new Error("model down");
    },
    () => ({ role: "assistant", content: "B DONE" }),
    () => ({ role: "assistant", content: "parent done" }),
  ]);
  const results = await runTurn(llm, budget);
  assert.equal(results.length, 4);
  assert.equal(results[0].isError, true);
  assert.match(results[0].content, /ended with status error/);
  assert.equal(results[1].content, "B DONE");
  assert.equal(results[1].isError, undefined);
  assert.equal(results[2].isError, true);
  assert.match(results[2].content, /\(not executed: an earlier sub-agent in this turn failed/);
  assert.equal(results[3].isError, true);
  assert.match(results[3].content, /\(not executed: an earlier sub-agent in this turn failed/);
  assert.equal(calls.length, 4);
});

test("a call waiting for a slot is released by abort without leaking the slot", async () => {
  const budget = new SubAgentBudget(1);
  assert.equal(budget.tryAcquire(), true);
  const { llm, calls } = fakeLLM([]);
  const controller = new AbortController();
  const run = runSubAgent(runOpts(llm, budget), "sys", "task", 1, controller.signal);
  controller.abort();
  await assert.rejects(run, /aborted/);
  assert.equal(calls.length, 0);
  budget.release();
  assert.equal(budget.tryAcquire(), true);
});
