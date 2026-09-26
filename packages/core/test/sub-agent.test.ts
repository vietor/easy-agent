import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/runtime/agent.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSubAgentTool, renderSubAgentGuidance } from "../src/tools/sub-agent.js";
import { runSubAgent } from "../src/runtime/sub-agent-runner.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient, LLMUsage } from "../src/llm/types.js";
import type { Tool } from "../src/tools/types.js";

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

function withUsage(usage: LLMUsage, message: LLMAssistantMessage) {
  return (opts: ChatOptions) => {
    opts.onUsage?.(usage);
    return message;
  };
}

function subAgentSchema(calls: ChatOptions[], index: number) {
  return calls[index].tools?.find((s) => s.function.name === "SubAgent");
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

function makeParentAgent(
  llm: LLMClient,
  subAgentOpts: { maxTurns?: number; maxSubAgentDepth?: number } = {}
): { agent: Agent; conversation: SessionMessages } {
  const tools = new ToolRegistry();
  tools.registerAll(SUB_TOOLS);
  tools.registerAll([...GENERAL_ONLY_TOOLS, ...SESSION_SCOPED_TOOLS]);
  let parentAgent: Agent;
  tools.register(createSubAgentTool({ runSubAgent: (systemPrompt, task, level, signal) => runSubAgent({ llm, tools, cwd: process.cwd(), sessionId: "s1", depth: 1, maxSubAgentDepth: subAgentOpts.maxSubAgentDepth ?? 3, maxTurns: subAgentOpts.maxTurns ?? 50, stallThreshold: 3, maxParallelToolCalls: 10, contextLimit: 750_000, onUsage: (usage) => parentAgent.addUsage(usage) }, systemPrompt, task, level, signal) }));
  const conversation = new SessionMessages("system prompt");
  parentAgent = new Agent({
    llm,
    conversation,
    tools,
    cwd: process.cwd(),
    getTodos: () => [],
    stallThreshold: 3,
    maxTurns: 50,
    maxParallelToolCalls: 10,
    contextLimit: 750_000,
  });
  return { agent: parentAgent, conversation };
}

test("nested sub-agent reply becomes the SubAgent tool result", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "find X" })),
    () => toolCall("Read", JSON.stringify({ path: "a.ts" }), "n1"),
    () => ({ role: "assistant", content: "FOUND X" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const { agent, conversation } = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = conversation.export().find((m) => m.role === "tool");
  assert.ok(toolMsg, "tool result must be in the conversation");
  assert.equal(toolMsg.content, "FOUND X");
  assert.ok(!toolMsg.isError);

  assert.match(String(calls[1].messages[0].content), /You are the Explore sub-agent/);
  assert.match(String(calls[1].messages[0].content), /Tool-Use Guidelines/);
  const nestedTools = calls[1].tools?.map((s) => s.function.name) ?? [];
  assert.deepEqual(nestedTools, ["Glob", "Grep", "Read", "SubAgent", "WebFetch"]);
  assert.ok(!nestedTools.some((n) => ["Shell", "Write", "Edit", "Skill"].includes(n)));
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
  const { agent, conversation } = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  assert.match(String(calls[1].messages[0].content), /You are the General sub-agent/);
  const nestedTools = calls[1].tools?.map((s) => s.function.name) ?? [];
  assert.deepEqual(nestedTools, ["Edit", "Glob", "Grep", "Read", "Shell", "SubAgent", "WebFetch", "Write"]);
  assert.ok(!nestedTools.some((n) => ["AskUser", "Skill", "TodoWrite"].includes(n)));

  const toolMsg = conversation.export().find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.equal(toolMsg.content, "IMPLEMENTED X");
  assert.ok(!toolMsg.isError);
});

test("sub-agent usage is added to the parent agent's counters", async () => {
  const { llm } = fakeLLM([
    (opts) => {
      opts.onUsage?.({ cacheInputTokens: 0, missInputTokens: 10, outputTokens: 5 });
      return toolCall("SubAgent", JSON.stringify({ type: "explore", task: "find X" }));
    },
    (opts) => {
      opts.onUsage?.({ cacheInputTokens: 15, missInputTokens: 20, outputTokens: 7 });
      return toolCall("Read", JSON.stringify({ path: "a.ts" }), "n1");
    },
    (opts) => {
      opts.onUsage?.({ cacheInputTokens: 0, missInputTokens: 30, outputTokens: 3 });
      return { role: "assistant", content: "FOUND X" };
    },
    (opts) => {
      opts.onUsage?.({ cacheInputTokens: 0, missInputTokens: 40, outputTokens: 9 });
      return { role: "assistant", content: "done" };
    },
  ]);
  const { agent } = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");
  assert.deepEqual(agent.usage, { cacheInputTokens: 15, missInputTokens: 100, outputTokens: 24 });
});

test("unknown sub-agent type returns an error without invoking a nested loop", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "bogus", task: "x" })),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const { agent, conversation } = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = conversation.export().find((m) => m.role === "tool");
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
  const { agent, conversation } = makeParentAgent(llm, { maxTurns: 1 });
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = conversation.export().find((m) => m.role === "tool");
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
  const { agent, conversation } = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");

  const toolMsg = conversation.export().find((m) => m.role === "tool");
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
  const full = renderSubAgentGuidance(false, 10, 50);
  assert.ok(full.includes("Valid type values: explore, plan, general"));
  assert.ok(full.includes("never fetch, search, or read the same thing in parallel with the sub-agent"));
  assert.ok(full.includes("never mark a file-changing delegated task done on the report alone"));
  assert.ok(full.includes('Use "explore" when the answer already exists in the codebase or on the web'));
  const readOnly = renderSubAgentGuidance(true, 10, 50);
  assert.ok(!readOnly.includes("general"));
  assert.ok(readOnly.includes("Valid type values: explore, plan"));
  assert.ok(readOnly.includes("verify important results yourself"));
  assert.ok(readOnly.includes('never use "plan" for fact-finding'));
});

test("SubAgent guidance per-turn cap follows maxParallelToolCalls within [1, 8]", () => {
  assert.ok(renderSubAgentGuidance(false, 3, 50).includes("at most 3 SubAgent calls per turn"));
  assert.ok(renderSubAgentGuidance(false, 40, 50).includes("at most 8 SubAgent calls per turn"));
  const serial = renderSubAgentGuidance(false, 1, 50);
  assert.ok(serial.includes("at most 1 SubAgent call per turn"));
  assert.ok(!serial.includes("Multiple SubAgent calls in the same turn run concurrently"));
  assert.ok(renderSubAgentGuidance(false, 0, 50).includes("at most 1 SubAgent call per turn"));
});

test("SubAgent guidance states the loop budget each sub-agent gets", () => {
  assert.ok(renderSubAgentGuidance(false, 10, 25).includes("its own loop budget of 25 tool-calling turns"));
  assert.ok(renderSubAgentGuidance(true, 10, 25).includes("its own loop budget of 25 tool-calling turns"));
});

test("a sub-agent below the nesting cap is given the delegation guidance", async () => {
  let system = "";
  let toolNames: string[] = [];
  const { llm } = fakeLLM([
    (opts) => {
      system = String(opts.messages[0].content);
      toolNames = opts.tools?.map((s) => s.function.name) ?? [];
      return { role: "assistant", content: "done" };
    },
  ]);
  const tools = new ToolRegistry();
  tools.registerAll([...SUB_TOOLS, ...GENERAL_ONLY_TOOLS]);
  const result = await runSubAgent(
    {
      llm,
      tools,
      cwd: process.cwd(),
      sessionId: "s1",
      depth: 1,
      maxSubAgentDepth: 3,
      maxTurns: 50,
      stallThreshold: 3,
      maxParallelToolCalls: 10,
      contextLimit: 750_000,
    },
    "You are the General sub-agent.",
    "task",
    2
  );
  assert.equal(result.status, "ok");
  assert.ok(system.includes("Tool-Use Guidelines:"), "the header must still be present");
  assert.ok(system.includes("Valid type values: explore, plan, general"));
  assert.ok(toolNames.includes("SubAgent"));
});

test("the deepest sub-agent is told it cannot spawn and gets no SubAgent tool", async () => {
  let system = "";
  let toolNames: string[] = [];
  const { llm } = fakeLLM([
    (opts) => {
      system = String(opts.messages[0].content);
      toolNames = opts.tools?.map((s) => s.function.name) ?? [];
      return { role: "assistant", content: "done" };
    },
  ]);
  const tools = new ToolRegistry();
  tools.registerAll([...SUB_TOOLS, ...GENERAL_ONLY_TOOLS]);
  const result = await runSubAgent(
    {
      llm,
      tools,
      cwd: process.cwd(),
      sessionId: "s1",
      depth: 3,
      maxSubAgentDepth: 3,
      maxTurns: 50,
      stallThreshold: 3,
      maxParallelToolCalls: 10,
      contextLimit: 750_000,
    },
    "You are the General sub-agent.",
    "task",
    2
  );
  assert.equal(result.status, "ok");
  assert.ok(system.includes("cannot spawn further sub-agents"));
  assert.ok(!system.includes("Valid type values"));
  assert.ok(!toolNames.includes("SubAgent"));
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
  const { agent, conversation } = makeParentAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");
  assert.equal(maxInflight, 2);
  const results = conversation.export().filter((m) => m.role === "tool" && !m.isError).map((m) => m.content);
  assert.ok(results.includes("RESULT A"));
  assert.ok(results.includes("RESULT B"));
});

test("a sub-agent can spawn a sub-agent and sees only its report", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "outer" }), "t1"),
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "inner" }), "n1"),
    () => ({ role: "assistant", content: "DEEP" }),
    () => ({ role: "assistant", content: "MID" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const { agent, conversation } = makeParentAgent(llm);
  assert.equal(await agent.run("go"), "ok");

  assert.match(String(calls[1].messages[0].content), /You are the Explore sub-agent/);
  assert.match(String(calls[2].messages[0].content), /You are the Explore sub-agent/);
  assert.ok(calls[2].tools?.some((s) => s.function.name === "SubAgent"));
  assert.ok(calls[3].messages.some((m) => m.role === "tool" && m.content === "DEEP"));

  const toolMessages = conversation.export().filter((m) => m.role === "tool").map((m) => m.content);
  assert.deepEqual(toolMessages, ["MID"]);
});

test("nesting stops at the deepest level", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "one" }), "t1"),
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "two" }), "n1"),
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "three" }), "n2"),
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "four" }), "n3"),
    () => ({ role: "assistant", content: "L3 DONE" }),
    () => ({ role: "assistant", content: "L2 DONE" }),
    () => ({ role: "assistant", content: "L1 DONE" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const { agent, conversation } = makeParentAgent(llm);
  assert.equal(await agent.run("go"), "ok");

  const deepestTools = calls[3].tools?.map((s) => s.function.name) ?? [];
  assert.ok(!deepestTools.includes("SubAgent"));
  assert.ok(String(calls[3].messages[0].content).includes("cannot spawn further sub-agents"));
  assert.ok(!String(calls[3].messages[0].content).includes("Valid type values"));
  assert.ok(calls[4].messages.some((m) => m.role === "tool" && String(m.content).includes("unknown tool")));

  const toolMessages = conversation.export().filter((m) => m.role === "tool").map((m) => m.content);
  assert.deepEqual(toolMessages, ["L1 DONE"]);
});

test("the nesting cap is configurable", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "outer" }), "t1"),
    () => ({ role: "assistant", content: "OUTER REPORT" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const { agent } = makeParentAgent(llm, { maxSubAgentDepth: 1 });
  assert.equal(await agent.run("go"), "ok");

  const nestedTools = calls[1].tools?.map((s) => s.function.name) ?? [];
  assert.ok(!nestedTools.includes("SubAgent"));
  assert.ok(String(calls[1].messages[0].content).includes("cannot spawn further sub-agents"));
});

test("usage from every nesting level is counted exactly once", async () => {
  const { llm } = fakeLLM([
    withUsage({ cacheInputTokens: 0, missInputTokens: 10, outputTokens: 1 }, toolCall("SubAgent", JSON.stringify({ type: "explore", task: "one" }), "t1")),
    withUsage({ cacheInputTokens: 0, missInputTokens: 20, outputTokens: 2 }, toolCall("SubAgent", JSON.stringify({ type: "explore", task: "two" }), "n1")),
    withUsage({ cacheInputTokens: 0, missInputTokens: 30, outputTokens: 3 }, toolCall("SubAgent", JSON.stringify({ type: "explore", task: "three" }), "n2")),
    withUsage({ cacheInputTokens: 0, missInputTokens: 40, outputTokens: 4 }, { role: "assistant", content: "L3" }),
    withUsage({ cacheInputTokens: 0, missInputTokens: 50, outputTokens: 5 }, { role: "assistant", content: "L2" }),
    withUsage({ cacheInputTokens: 0, missInputTokens: 60, outputTokens: 6 }, { role: "assistant", content: "L1" }),
    withUsage({ cacheInputTokens: 0, missInputTokens: 70, outputTokens: 7 }, { role: "assistant", content: "done" }),
  ]);
  const { agent } = makeParentAgent(llm);
  assert.equal(await agent.run("go"), "ok");
  assert.deepEqual(agent.usage, { cacheInputTokens: 0, missInputTokens: 280, outputTokens: 28 });
});

test("a read-only sub-agent cannot delegate to a writable child", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "outer" }), "t1"),
    () => ({ role: "assistant", content: "OUTER REPORT" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const { agent } = makeParentAgent(llm);
  assert.equal(await agent.run("go"), "ok");

  const nestedTools = calls[1].tools?.map((s) => s.function.name) ?? [];
  assert.deepEqual(nestedTools, ["Glob", "Grep", "Read", "SubAgent", "WebFetch"]);

  const params = subAgentSchema(calls, 1)?.function.parameters as { properties: { type: { enum: string[] } } };
  assert.deepEqual(params.properties.type.enum, ["explore", "plan"]);
  const system = String(calls[1].messages[0].content);
  assert.ok(system.includes("Valid type values: explore, plan"));
  assert.ok(!system.includes("general"));
});

test("a writable sub-agent delegates to writable children", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "general", task: "one" }), "t1"),
    () => toolCall("SubAgent", JSON.stringify({ type: "general", task: "two" }), "n1"),
    () => toolCall("Shell", JSON.stringify({ command: "true" }), "n2"),
    () => ({ role: "assistant", content: "L2 DONE" }),
    () => ({ role: "assistant", content: "L1 DONE" }),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const { agent } = makeParentAgent(llm);
  assert.equal(await agent.run("go"), "ok");

  assert.match(String(calls[2].messages[0].content), /You are the General sub-agent/);
  const nestedTools = calls[2].tools?.map((s) => s.function.name) ?? [];
  assert.ok(nestedTools.includes("Shell"));
  assert.ok(nestedTools.includes("Write"));
  assert.ok(nestedTools.includes("Edit"));
});

test("nested sub-agents inherit the run's abort signal", async () => {
  const controller = new AbortController();
  let nestedSignal: AbortSignal | undefined;
  const probe: Tool = {
    name: "Probe",
    agentLevel: 1,
    description: "probe",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx) {
      nestedSignal = ctx.signal;
      return { content: "probed" };
    },
  };
  const { llm } = fakeLLM([
    () => toolCall("SubAgent", JSON.stringify({ type: "explore", task: "inner" }), "n1"),
    () => toolCall("Probe", "{}", "n2"),
    () => ({ role: "assistant", content: "inner done" }),
    () => ({ role: "assistant", content: "outer done" }),
  ]);
  const tools = new ToolRegistry();
  tools.registerAll([...SUB_TOOLS, probe]);
  const result = await runSubAgent(
    {
      llm,
      tools,
      cwd: process.cwd(),
      sessionId: "s1",
      depth: 1,
      maxSubAgentDepth: 3,
      maxTurns: 50,
      stallThreshold: 3,
      maxParallelToolCalls: 10,
      contextLimit: 750_000,
    },
    "You are the Explore sub-agent.",
    "task",
    1,
    controller.signal
  );
  assert.equal(result.status, "ok");
  assert.equal(nestedSignal, controller.signal);
});

test("a read-only sub-agent's report is saved where the parent can read it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sub-notes-readonly-"));
  try {
    let system = "";
    const { llm } = fakeLLM([
      (opts) => {
        system = String(opts.messages[0].content);
        return { role: "assistant", content: "the report" };
      },
    ]);
    const tools = new ToolRegistry();
    tools.registerAll(SUB_TOOLS);
    const result = await runSubAgent(
      {
        llm,
        tools,
        cwd: process.cwd(),
        sessionId: "s1",
        depth: 1,
        maxSubAgentDepth: 3,
        maxTurns: 50,
        stallThreshold: 3,
        maxParallelToolCalls: 10,
        contextLimit: 750_000,
        scratchDir: dir,
      },
      "You are the Explore sub-agent.",
      "task",
      1
    );
    assert.equal(result.status, "ok");
    assert.ok(result.notesPath);
    assert.match(result.notesPath, /s1\.[0-9A-Za-z]{11}\.notes\.md$/, "the notes file is named for its session, so the sweep can identify it");
    assert.equal(await readFile(result.notesPath, "utf-8"), "\n## Sub-agent report\n\nthe report\n");
    assert.ok(!system.includes(result.notesPath), "a read-only sub-agent has no Write tool, so it must not be told to keep notes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a scratch directory that does not exist yet is created for the report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sub-notes-missing-"));
  try {
    const { llm } = fakeLLM([() => ({ role: "assistant", content: "the report" })]);
    const tools = new ToolRegistry();
    tools.registerAll(SUB_TOOLS);
    const result = await runSubAgent(
      {
        llm,
        tools,
        cwd: process.cwd(),
        sessionId: "s1",
        depth: 1,
        maxSubAgentDepth: 3,
        maxTurns: 50,
        stallThreshold: 3,
        maxParallelToolCalls: 10,
        contextLimit: 750_000,
        scratchDir: join(dir, "scratch"),
      },
      "You are the Explore sub-agent.",
      "task",
      1
    );
    assert.equal(result.status, "ok");
    assert.ok(result.notesPath);
    assert.equal(await readFile(result.notesPath, "utf-8"), "\n## Sub-agent report\n\nthe report\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a report survives a notes file that cannot be written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sub-notes-fail-"));
  try {
    await writeFile(join(dir, "blocker"), "x", "utf-8");
    const { llm } = fakeLLM([() => ({ role: "assistant", content: "the report" })]);
    const tools = new ToolRegistry();
    tools.registerAll(SUB_TOOLS);
    const result = await runSubAgent(
      {
        llm,
        tools,
        cwd: process.cwd(),
        sessionId: "s1",
        depth: 1,
        maxSubAgentDepth: 3,
        maxTurns: 50,
        stallThreshold: 3,
        maxParallelToolCalls: 10,
        contextLimit: 750_000,
        scratchDir: join(dir, "blocker", "scratch"),
      },
      "You are the Explore sub-agent.",
      "task",
      1
    );
    assert.equal(result.status, "ok");
    assert.equal(result.reply, "the report");
    assert.equal(result.notesPath, undefined, "a path must not be reported for a file that was never written");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a writable sub-agent is told where to record facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sub-notes-writable-"));
  try {
    let system = "";
    const { llm } = fakeLLM([
      (opts) => {
        system = String(opts.messages[0].content);
        return { role: "assistant", content: "done" };
      },
    ]);
    const tools = new ToolRegistry();
    tools.registerAll([...SUB_TOOLS, ...GENERAL_ONLY_TOOLS]);
    const result = await runSubAgent(
      {
        llm,
        tools,
        cwd: process.cwd(),
        sessionId: "s1",
        depth: 1,
        maxSubAgentDepth: 3,
        maxTurns: 50,
        stallThreshold: 3,
        maxParallelToolCalls: 10,
        contextLimit: 750_000,
        scratchDir: dir,
      },
      "You are the General sub-agent.",
      "task",
      2
    );
    assert.equal(result.status, "ok");
    assert.ok(system.includes(String(result.notesPath)), "the notes file it was told to keep is the one reported back");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a sub-agent that never finishes also gets its notes file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sub-notes-maxturns-"));
  try {
    const { llm } = fakeLLM([
      () => toolCall("Read", JSON.stringify({ path: "a.ts" })),
      () => toolCall("Read", JSON.stringify({ path: "a.ts" })),
    ]);
    const tools = new ToolRegistry();
    tools.registerAll(SUB_TOOLS);
    const result = await runSubAgent(
      {
        llm,
        tools,
        cwd: process.cwd(),
        sessionId: "s1",
        depth: 1,
        maxSubAgentDepth: 3,
        maxTurns: 1,
        stallThreshold: 3,
        maxParallelToolCalls: 10,
        contextLimit: 750_000,
        scratchDir: dir,
      },
      "You are the Explore sub-agent.",
      "task",
      1
    );
    assert.equal(result.status, "maxTurns");
    assert.ok(result.notesPath, "a run that produced no report still leaves a record of what it did");
    assert.equal((await readdir(dir)).filter((name) => name.endsWith(".notes.md")).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a report too large for the notes file is bounded there and marked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sub-notes-big-"));
  try {
    const report = Array.from({ length: 1500 }, (_, i) => `finding ${i} ${"x".repeat(60)}`).join("\n");
    const { llm } = fakeLLM([() => ({ role: "assistant", content: report })]);
    const tools = new ToolRegistry();
    tools.registerAll(SUB_TOOLS);
    const result = await runSubAgent(
      {
        llm,
        tools,
        cwd: process.cwd(),
        sessionId: "s1",
        depth: 1,
        maxSubAgentDepth: 3,
        maxTurns: 50,
        stallThreshold: 3,
        maxParallelToolCalls: 10,
        contextLimit: 750_000,
        scratchDir: dir,
      },
      "You are the Explore sub-agent.",
      "task",
      1
    );
    assert.equal(result.status, "ok");
    const saved = await readFile(String(result.notesPath), "utf-8");
    assert.ok(saved.length < report.length, "a runaway report must not grow the notes file without bound");
    assert.match(saved, /\(report truncated in this file: first \d+ of \d+ lines\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a sub-agent run without a scratch directory reports no notes path", async () => {
  const { llm } = fakeLLM([() => ({ role: "assistant", content: "the report" })]);
  const tools = new ToolRegistry();
  tools.registerAll(SUB_TOOLS);
  const result = await runSubAgent(
    { llm, tools, cwd: process.cwd(), sessionId: "s1", depth: 1, maxSubAgentDepth: 3, maxTurns: 50, stallThreshold: 3, maxParallelToolCalls: 10, contextLimit: 750_000 },
    "You are the Explore sub-agent.",
    "task",
    1
  );
  assert.equal(result.status, "ok");
  assert.equal(result.notesPath, undefined);
});

test("the SubAgent tool result points at the saved report", async () => {
  const saved = join(tmpdir(), "saved.notes.md");
  const tool = createSubAgentTool({
    runSubAgent: async () => ({ status: "ok", reply: "the report", messages: [], notesPath: saved }),
  });
  const readOnly = await tool.execute({ type: "explore", task: "x" }, { cwd: process.cwd() });
  assert.equal(
    readOnly.content,
    `the report\n\nFull report saved to: ${saved}\nRe-read it after a context compaction instead of re-running this sub-agent.`
  );
  const writable = await tool.execute({ type: "general", task: "x" }, { cwd: process.cwd() });
  assert.equal(
    writable.content,
    `the report\n\nFull report and notes saved to: ${saved}\nRead that file for detail beyond this report, or after a context compaction.`
  );

  const bare = createSubAgentTool({ runSubAgent: async () => ({ status: "ok", reply: "the report", messages: [] }) });
  assert.equal((await bare.execute({ type: "explore", task: "x" }, { cwd: process.cwd() })).content, "the report");

  const failed = createSubAgentTool({
    runSubAgent: async () => ({ status: "stalled", reply: "gave up", messages: [], notesPath: saved }),
  });
  const failedResult = await failed.execute({ type: "explore", task: "x" }, { cwd: process.cwd() });
  assert.equal(failedResult.isError, true);
  assert.match(String(failedResult.content), /gave up\n\nFull report saved to: /);
});
