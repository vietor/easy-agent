import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/runtime/agent.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient } from "../src/llm/types.js";
import type { Tool } from "../src/tools/types.js";
import { sleep } from "./helpers.js";

interface Tracker {
  inflight: number;
  max: number;
}

function turn(...names: string[]): LLMAssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: names.map((name, i) => ({ id: `t${i}`, type: "function", function: { name, arguments: "{}" } })),
  };
}

function trackingTool(name: string, tracker: Tracker, safe?: boolean, delay = 10): Tool {
  return {
    name,
    concurrencySafe: safe,
    description: name,
    parameters: { type: "object", properties: {} },
    async execute() {
      tracker.inflight++;
      tracker.max = Math.max(tracker.max, tracker.inflight);
      await sleep(delay);
      tracker.inflight--;
      return { content: name };
    },
  };
}

async function runTurn(tools: Tool[], calls: LLMAssistantMessage): Promise<SessionMessages> {
  const script: Array<(opts: ChatOptions) => LLMAssistantMessage> = [
    () => calls,
    () => ({ role: "assistant", content: "done" }),
  ];
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
  const registry = new ToolRegistry();
  registry.registerAll(tools);
  const conversation = new SessionMessages("system prompt");
  const agent = new Agent({
    llm,
    conversation,
    tools: registry,
    cwd: process.cwd(),
    getTodos: () => [],
    stallThreshold: 3,
    maxTurns: 50,
    maxParallelToolCalls: 10,
    contextLimit: 750_000,
  });
  await agent.run("go");
  return conversation;
}

function toolResults(conversation: SessionMessages): string[] {
  return conversation.export().filter((m) => m.role === "tool").map((m) => m.content);
}

test("consecutive concurrency-safe calls in one turn run together", async () => {
  const tracker: Tracker = { inflight: 0, max: 0 };
  await runTurn(
    [trackingTool("R1", tracker, true), trackingTool("R2", tracker, true), trackingTool("R3", tracker, true)],
    turn("R1", "R2", "R3")
  );
  assert.equal(tracker.max, 3);
});

test("calls that are not concurrency-safe run one at a time", async () => {
  const tracker: Tracker = { inflight: 0, max: 0 };
  await runTurn(
    [trackingTool("W1", tracker), trackingTool("W2", tracker), trackingTool("W3", tracker)],
    turn("W1", "W2", "W3")
  );
  assert.equal(tracker.max, 1);
});

test("a call that is not concurrency-safe splits the safe run around it", async () => {
  const tracker: Tracker = { inflight: 0, max: 0 };
  await runTurn(
    [
      trackingTool("R1", tracker, true),
      trackingTool("R2", tracker, true),
      trackingTool("W1", tracker),
      trackingTool("R3", tracker, true),
      trackingTool("R4", tracker, true),
    ],
    turn("R1", "R2", "W1", "R3", "R4")
  );
  assert.equal(tracker.max, 2);
});

test("a tool that declares nothing is treated as not concurrency-safe", async () => {
  const tracker: Tracker = { inflight: 0, max: 0 };
  await runTurn([trackingTool("U1", tracker), trackingTool("U2", tracker)], turn("U1", "U2"));
  assert.equal(tracker.max, 1);
});

test("results follow tool-call order even when a later call finishes first", async () => {
  const tracker: Tracker = { inflight: 0, max: 0 };
  const conversation = await runTurn(
    [trackingTool("R1", tracker, true, 20), trackingTool("R2", tracker, true, 5)],
    turn("R1", "R2")
  );
  assert.deepEqual(toolResults(conversation), ["R1", "R2"]);
});
