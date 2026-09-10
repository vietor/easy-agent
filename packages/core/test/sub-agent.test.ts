import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/runtime/agent.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSubAgentTool, renderSubAgentGuidance } from "../src/tools/sub-agent.js";
import { runSubAgent } from "../src/runtime/sub-agent-runner.js";
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

function toolCall(name: string, args = "{}", id = "t1"): LLMAssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}

function stub(name: string, content: string, agentLevel = 0) {
  return {
    name,
    agentLevel,
    description: name,
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content };
    },
  };
}

const SUB_TOOLS = [stub("Read", "file contents", 1), stub("Glob", "matches", 1), stub("Grep", "hits", 1), stub("WebFetch", "web", 1)];
const GENERAL_ONLY_TOOLS = [stub("Shell", "ok", 2), stub("Write", "written", 2), stub("Edit", "edited", 2)];
const SESSION_SCOPED_TOOLS = [stub("AskUser", "asked"), stub("Skill", "skilled"), stub("TodoWrite", "todos")];

function makeParentAgent(llm: LLMClient, subAgentOpts: { maxTurns?: number } = {}): Agent {
  const tools = new ToolRegistry();
  tools.registerAll(SUB_TOOLS);
  tools.registerAll([...GENERAL_ONLY_TOOLS, ...SESSION_SCOPED_TOOLS]);
  let parentAgent: Agent;
  tools.register(createSubAgentTool({ runSubAgent: (systemPrompt, task, level) => runSubAgent({ llm, tools, cwd: process.cwd(), maxTurns: subAgentOpts.maxTurns ?? 50, stallThreshold: 3, maxParallelToolCalls: 10, contextLimit: 750_000, onUsage: (cacheInputTokens, missInputTokens, outputTokens) => parentAgent.addUsage(cacheInputTokens, missInputTokens, outputTokens) }, systemPrompt, task, level) }));
  const conversation = new SessionMessages("system prompt");
  parentAgent = new Agent({
    llm,
    conversation,
    tools,
    cwd: process.cwd(),
    setTodos: () => {},
    getTodos: () => [],
    stallThreshold: 3,
    maxTurns: 50,
    maxParallelToolCalls: 10,
    contextLimit: 750_000,
  });
  return parentAgent;
}

test("nested sub-agent reply becomes the SubAgent tool result", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "find X" })),
    () => toolCall("Read", JSON.stringify({ path: "a.ts" }), "n1"),
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
  assert.deepEqual(nestedTools, ["Read", "Glob", "Grep", "WebFetch"]);
  assert.ok(!nestedTools.some((n) => ["SubAgent", "Shell", "Write", "Edit", "Skill"].includes(n)));
  assert.ok(
    calls[2].messages.some(
      (m) => m.role === "tool" && typeof m.content === "string" && m.content.includes("file contents")
    )
  );
});

test("general sub-agent gets writable tools but not session-scoped ones", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "general", task: "implement X" })),
    () => toolCall("Shell", JSON.stringify({ command: "true" }), "n1"),
    () => ({ role: "assistant", content: "IMPLEMENTED X" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  assert.match(String(calls[1].messages[0].content), /You are the General sub-agent/);
  const nestedTools = calls[1].tools?.map((s) => s.function.name) ?? [];
  assert.deepEqual(nestedTools, ["Read", "Glob", "Grep", "WebFetch", "Shell", "Write", "Edit"]);
  assert.ok(!nestedTools.some((n) => ["SubAgent", "AskUser", "Skill", "TodoWrite"].includes(n)));

  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.equal(toolMsg.content, "IMPLEMENTED X");
  assert.ok(!toolMsg.isError);
});

test("sub-agent usage is added to the parent agent's counters", async () => {
  const { llm } = fakeLLM([
    (opts) => {
      opts.onUsage?.(0, 10, 5);
      return toolCall("SubAgent", JSON.stringify({ type: "explore", task: "find X" }));
    },
    (opts) => {
      opts.onUsage?.(15, 20, 7);
      return toolCall("Read", JSON.stringify({ path: "a.ts" }), "n1");
    },
    (opts) => {
      opts.onUsage?.(0, 30, 3);
      return { role: "assistant", content: "FOUND X" };
    },
    (opts) => {
      opts.onUsage?.(0, 40, 9);
      return { role: "assistant", content: "done" };
    },
  ]);
  const agent = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");
  assert.deepEqual(agent.usage, { cacheInputTokens: 15, missInputTokens: 100, outputTokens: 24 });
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
    () => toolCall("Read", JSON.stringify({ path: "a.ts" }), "n1"),
    () => toolCall("Glob", JSON.stringify({ pattern: "*.ts" }), "n2"),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeParentAgent(llm, { maxTurns: 1 });
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.equal(toolMsg.isError, true);
  assert.ok(String(toolMsg.content).includes("maxTurns"));
});

test("stalled sub-agent reports the repeated tool call in its result", async () => {
  const { llm } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "find X" })),
    () => toolCall("Read", JSON.stringify({ path: "a.ts" }), "n1"),
    () => toolCall("Read", JSON.stringify({ path: "a.ts" }), "n2"),
    () => toolCall("Read", JSON.stringify({ path: "a.ts" }), "n3"),
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
  assert.ok(String(toolMsg.content).includes("Read"));
});

test("SubAgent tool type enum covers explore, plan and general", () => {
  const tool = createSubAgentTool({ runSubAgent: async () => ({ status: "ok", reply: "", messages: [] }) });
  const params = tool.parameters as { properties: { type: { enum: string[] } } };
  assert.deepEqual(params.properties.type.enum, ["explore", "plan", "general"]);
});

test("read-only session restricts SubAgent types to explore and plan", async () => {
  const ran: string[] = [];
  const tool = createSubAgentTool({
    runSubAgent: async () => {
      ran.push("ran");
      return { status: "ok", reply: "", messages: [] };
    },
  }, true);
  const params = tool.parameters as { properties: { type: { enum: string[] } } };
  assert.deepEqual(params.properties.type.enum, ["explore", "plan"]);
  assert.ok(!tool.description.includes('"general"'));
  const result = await tool.execute({ type: "general", task: "x" }, { cwd: process.cwd() });
  assert.equal(result.isError, true);
  assert.deepEqual(ran, []);
});

test("SubAgent guidance omits general in read-only sessions", () => {
  const full = renderSubAgentGuidance(false, 10);
  assert.ok(full.includes("Valid type values: explore, plan, general"));
  assert.ok(full.includes("never mark a delegated task done on the report alone"));
  assert.ok(full.includes('Use "explore" when the answer already exists in the codebase or on the web'));
  const readOnly = renderSubAgentGuidance(true, 10);
  assert.ok(!readOnly.includes("general"));
  assert.ok(readOnly.includes("Valid type values: explore, plan"));
  assert.ok(readOnly.includes("verify important results yourself"));
  assert.ok(readOnly.includes('never use "plan" for fact-finding'));
});

test("SubAgent guidance per-turn cap follows maxParallelToolCalls within [1, 8]", () => {
  assert.ok(renderSubAgentGuidance(false, 3).includes("at most 3 SubAgent calls per turn"));
  assert.ok(renderSubAgentGuidance(false, 40).includes("at most 8 SubAgent calls per turn"));
  const serial = renderSubAgentGuidance(false, 1);
  assert.ok(serial.includes("at most 1 SubAgent call per turn"));
  assert.ok(!serial.includes("Multiple SubAgent calls in the same turn run concurrently"));
  assert.ok(renderSubAgentGuidance(false, 0).includes("at most 1 SubAgent call per turn"));
});

test("SubAgent label is capped at 50 chars and shown after the type name", () => {
  const tool = createSubAgentTool({ runSubAgent: async () => ({ status: "ok", reply: "", messages: [] }) });
  const params = tool.parameters as { properties: { label: { maxLength: number } } };
  assert.equal(params.properties.label.maxLength, 50);
  const summarize = tool.summarizeArgs!;
  assert.equal(summarize({ type: "explore", label: "find the bug" }), "Explore find the bug");
  assert.equal(summarize({ type: "plan" }), "Plan");
  assert.equal(summarize({ type: "general", label: "implement A" }), "General implement A");
  assert.equal(summarize({ type: "explore", label: "x".repeat(60) }), `Explore ${"x".repeat(50)}…`);
});

test("multiple SubAgent calls in one turn run concurrently", async () => {
  let inflight = 0;
  let maxInflight = 0;
  let release: (() => void) | undefined;
  const bothRunning = new Promise<void>((r) => {
    release = r;
  });
  const calls: ChatOptions[] = [];
  const script: Array<() => LLMAssistantMessage> = [
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
    thinkingEffort: "high",
    maxInputTokens: 200000,
    maxOutputTokens: 128000,
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
