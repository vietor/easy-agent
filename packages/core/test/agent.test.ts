import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/runtime/agent.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { Session } from "../src/runtime/session.js";
import { MCPServerManager } from "../src/mcp/manager.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { Skill } from "../src/skills/types.js";
import type { LLMAssistantMessage, LLMMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient } from "../src/llm/types.js";
import type { Todo } from "../src/tools/types.js";
import type { TextResult } from "../src/tools/types.js";
import { sleep, waitUntil } from "./helpers.js";

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

function makeAgent(
  llm: LLMClient,
  opts: { maxTurns?: number; contextLimit?: number; getTodos?: () => readonly Todo[]; resolveSkill?: (name: string) => Skill | undefined } = {}
): Agent {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: "echoed" };
    },
  });
  const conversation = new SessionMessages("system prompt");
  return new Agent({
    llm,
    conversation,
    tools,
    cwd: process.cwd(),
    setTodos: () => {},
    getTodos: opts.getTodos ?? (() => []),
    stallThreshold: 3,
    maxTurns: opts.maxTurns ?? 50,
    maxParallelToolCalls: 10,
    contextLimit: opts.contextLimit ?? 750_000,
    resolveSkill: opts.resolveSkill,
  });
}

function textContent(m: LLMMessage): string {
  return typeof m.content === "string" ? m.content : m.content?.map((p) => p.text).join("") ?? "";
}

test("text-only response completes with ok", async () => {
  const { llm } = fakeLLM([() => ({ role: "assistant", content: "done" })]);
  const agent = makeAgent(llm);
  const status = await agent.run("hi");
  assert.equal(status, "ok");
  assert.equal(agent.export().length, 2);
});

test("tool call executes and its result is stored in the conversation", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => ({ role: "assistant", content: "done" })]);
  const agent = makeAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");
  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg, "tool result must be in the conversation");
  assert.equal(toolMsg.content, "echoed");
});

test("usage accumulates across all successful calls in a run", async () => {
  const { llm } = fakeLLM([
    (opts) => {
      opts.onUsage?.(60, 100, 10);
      return toolCall("Echo");
    },
    (opts) => {
      opts.onUsage?.(140, 200, 20);
      return { role: "assistant", content: "done" };
    },
  ]);
  const agent = makeAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "ok");
  assert.deepEqual(agent.usage, { cacheInputTokens: 200, missInputTokens: 300, outputTokens: 30 });
});

test("a failing call's usage is not added to the counters", async () => {
  const { llm } = fakeLLM([
    (opts) => {
      opts.onUsage?.(100, 10);
      throw new Error("boom");
    },
  ]);
  const agent = makeAgent(llm);
  const status = await agent.run("go");
  assert.equal(status, "error");
  assert.deepEqual(agent.usage, { cacheInputTokens: 0, missInputTokens: 0, outputTokens: 0 });
});

test("stalls on repeated identical tool calls", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => toolCall("Echo"), () => toolCall("Echo")]);
  const agent = makeAgent(llm);
  const status = await agent.run("do it");
  assert.equal(status, "stalled");
  const last = agent.export().pop() as { content: string };
  assert.match(last.content, /repeated identical tool calls: Echo/);
});

test("every assistant tool_calls is followed by its tool results, even on stall", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => toolCall("Echo"), () => toolCall("Echo")]);
  const agent = makeAgent(llm);
  const status = await agent.run("do it");
  assert.equal(status, "stalled");
  const messages = agent.export();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    const following = messages.slice(i + 1, i + 1 + m.tool_calls.length);
    assert.ok(following.every((f) => f.role === "tool"), "tool results must follow tool calls");
    assert.deepEqual(
      following.map((f) => (f as { tool_call_id: string }).tool_call_id),
      m.tool_calls.map((tc) => tc.id)
    );
  }
});

test("maxTurns run records placeholder results for the pending tool calls", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => toolCall("Echo")]);
  const agent = makeAgent(llm, { maxTurns: 2 });
  const status = await agent.run("go");
  assert.equal(status, "maxTurns");
  const messages = agent.export();
  assert.equal(messages[messages.length - 2].role, "assistant");
  const last = messages[messages.length - 1];
  assert.equal(last.role, "tool");
  assert.equal((last as { isError?: boolean }).isError, true);
  assert.match((last as { content: string }).content, /not executed/);
});

test("text-only stall with incomplete todos: nudge is sent but never stored", async () => {
  const { llm, calls } = fakeLLM([
    () => ({ role: "assistant", content: "thinking..." }),
    () => ({ role: "assistant", content: "still thinking" }),
    () => ({ role: "assistant", content: "done-ish" }),
  ]);
  const agent = makeAgent(llm, { getTodos: () => [{ content: "t", status: "pending" }] });
  const status = await agent.run("work");
  assert.equal(status, "stalled");
  const texts = agent.export().map((m) => (typeof m.content === "string" ? m.content : ""));
  assert.ok(!texts.some((t) => t.includes("STOP!")));
  assert.ok(calls[1].messages.some((m) => m.role === "user" && textContent(m).includes("STOP!")));
});

test("maxTurns aborts after the configured limit of tool-call turns", async () => {
  const { llm } = fakeLLM([() => toolCall("Echo"), () => toolCall("Echo")]);
  const agent = makeAgent(llm, { maxTurns: 2 });
  const status = await agent.run("go");
  assert.equal(status, "maxTurns");
});

test("abort rolls the conversation back to the pre-run snapshot", async () => {
  const controller = new AbortController();
  const { llm } = fakeLLM([
    () => {
      controller.abort();
      return { role: "assistant", content: "partial" };
    },
  ]);
  const agent = makeAgent(llm);
  const status = await agent.run("go", undefined, controller.signal);
  assert.equal(status, "aborted");
  assert.equal(agent.export().length, 1);
  assert.equal(agent.export()[0].content, "go");
});

test("aborted run resolves hanging tool entries in the timeline", async () => {
  const tools = new ToolRegistry();
  tools.register({
    name: "Echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    execute: () => new Promise<TextResult>(() => {}),
  });
  const { llm } = fakeLLM([() => toolCall("Echo")]);
  const session = new Session({
    systemPrompt: "test",
    llm,
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
  });
  session.subscribe(() => {});
  const run = session.prompt("go");
  assert.ok(
    await waitUntil(() => session.getSnapshot().timeline.some((e) => e.type === "tool"), 5000),
    "tool entry must appear before the run settles"
  );
  session.abort();
  const { status } = await run;
  assert.equal(status, "aborted");
  const tool = session.getSnapshot().timeline.find((e) => e.type === "tool");
  assert.ok(tool && tool.type === "tool");
  assert.equal(tool.result, "aborted");
  assert.equal(tool.isError, true);
});

test("auto-compact failure surfaces an error event", async () => {
  const { llm } = fakeLLM([
    () => {
      throw new Error("compact boom");
    },
  ]);
  const events: string[] = [];
  const agent = makeAgent(llm, { contextLimit: 1000 });
  const status = await agent.run("a".repeat(5000), (e) => events.push(e.type));
  assert.equal(status, "error");
  assert.ok(events.includes("error"), "compact failure must emit an error event");
});

test("abort after auto-compact still rolls the conversation back", async () => {
  const controller = new AbortController();
  const { llm } = fakeLLM([
    (opts) => {
      const hasPrompt = opts.messages.some((m) => textContent(m).includes("Summarize the conversation above"));
      assert.ok(hasPrompt, "first call must be the compaction request");
      return { role: "assistant", content: "SUMMARY" };
    },
    () => {
      controller.abort();
      return { role: "assistant", content: "partial" };
    },
  ]);
  const agent = makeAgent(llm, { contextLimit: 1000 });
  const status = await agent.run("a".repeat(5000), undefined, controller.signal);
  assert.equal(status, "aborted");
  assert.deepEqual(agent.export().map((m) => m.content), ["a".repeat(5000)]);
});

test("auto-compact fires above the threshold and the run continues", async () => {
  const { llm, calls } = fakeLLM([
    (opts) => {
      const hasPrompt = opts.messages.some((m) => textContent(m).includes("Summarize the conversation above"));
      assert.ok(hasPrompt, "first call must be the compaction request");
      return { role: "assistant", content: "SUMMARY" };
    },
    () => ({ role: "assistant", content: "done" }),
  ]);
  const agent = makeAgent(llm, { contextLimit: 1000 });
  const status = await agent.run("a".repeat(5000));
  assert.equal(status, "ok");
  assert.deepEqual(agent.export().map((m) => m.content), ["SUMMARY", "done"]);
});

test("a Skill tool call injects the skill prompt and emits a skill event", async () => {
  const skill: Skill = { name: "x", description: "d", prompt: "SKILL PROMPT X" };
  const { llm, calls } = fakeLLM([
    () => toolCall("Skill", JSON.stringify({ name: "x" })),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const events: string[] = [];
  const agent = makeAgent(llm, {
    resolveSkill: (n) => (n === "x" ? skill : undefined),
  });
  const status = await agent.run("go", (e) => events.push(e.type));
  assert.equal(status, "ok");
  const skillMsg = agent.export().find((m) => m.role === "skill");
  assert.ok(skillMsg, "skill message must be in the conversation");
  assert.equal((skillMsg as { name?: string }).name, "x");
  assert.equal(skillMsg.content, '<skill "x" invoked - its instructions were followed above>');
  assert.deepEqual(events.filter((t) => t === "skill"), ["skill"]);
  assert.ok(calls[1].messages.some((m) => m.role === "user" && textContent(m).includes("SKILL PROMPT X")));
});

test("malformed Skill arguments are tolerated as a tool error", async () => {
  const { llm, calls } = fakeLLM([
    () => toolCall("Skill", "null"),
    () => ({ role: "assistant", content: "done" }),
  ]);
  const events: string[] = [];
  const agent = makeAgent(llm, { resolveSkill: () => undefined });
  const status = await agent.run("go", (e) => events.push(e.type));
  assert.equal(status, "ok");
  assert.equal(agent.export().find((m) => m.role === "skill"), undefined);
  const toolMsg = agent.export().find((m) => m.role === "tool");
  assert.ok(toolMsg, "tool result must be present");
  assert.equal((toolMsg as { isError?: boolean }).isError, true);
  assert.ok(!events.includes("skill"));
  assert.ok(!calls[1].messages.some((m) => m.role === "user" && textContent(m).includes("SKILL PROMPT")));
});

test("a tool resolving after the run settles cannot mutate the conversation", async () => {
  const tools = new ToolRegistry();
  let release!: (content: string) => void;
  const gate = new Promise<string>((r) => { release = r; });
  tools.register({
    name: "Slow",
    description: "slow",
    parameters: { type: "object", properties: {} },
    execute: () => gate,
  });
  const { llm } = fakeLLM([() => toolCall("Slow")]);
  const session = new Session({
    systemPrompt: "test",
    llm,
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
  });
  session.subscribe(() => {});
  const run = session.prompt("go");
  assert.ok(
    await waitUntil(() => session.getSnapshot().timeline.some((e) => e.type === "tool"), 5000),
    "tool entry must appear before the run settles"
  );
  session.abort();
  const { status } = await run;
  assert.equal(status, "aborted");
  const before = session.export();
  release("late result");
  await sleep(50);
  assert.deepEqual(session.export(), before);
  assert.ok(!session.export().some((m) => m.role === "tool"));
});

test("aborting during chat emits exactly one interrupted event", async () => {
  const tools = new ToolRegistry();
  const { llm } = fakeLLM([() => new Promise<LLMAssistantMessage>(() => {})]);
  const session = new Session({
    systemPrompt: "test",
    llm,
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit: 750_000,
  });
  session.subscribe(() => {});
  const events: string[] = [];
  session.onEvent((e) => events.push(e.type));
  const run = session.prompt("go");
  assert.ok(await waitUntil(() => session.running, 5000), "run must start");
  session.abort();
  const { status } = await run;
  assert.equal(status, "aborted");
  assert.equal(events.filter((t) => t === "interrupted").length, 1);
  assert.ok(!events.includes("error"));
});

test("aborting during auto-compact emits exactly one interrupted event", async () => {
  const controller = new AbortController();
  const { llm, calls } = fakeLLM([() => new Promise<LLMAssistantMessage>(() => {})]);
  const events: string[] = [];
  const agent = makeAgent(llm, { contextLimit: 1000 });
  const run = agent.run("a".repeat(5000), (e) => events.push(e.type), controller.signal);
  assert.ok(await waitUntil(() => calls.length === 1, 5000), "compact call must start");
  controller.abort();
  const status = await run;
  assert.equal(status, "aborted");
  assert.equal(events.filter((t) => t === "interrupted").length, 1);
  assert.deepEqual(agent.export().map((m) => m.content), ["a".repeat(5000)]);
});

test("a failing tool summary leaves the conversation well-formed for the next turn", async () => {
  const tools = new ToolRegistry();
  tools.register({
    name: "Boom",
    description: "throws",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: "result" };
    },
    summarizeResult() {
      throw new Error("summary boom");
    },
  });
  const { llm } = fakeLLM([() => toolCall("Boom")]);
  const conversation = new SessionMessages("system prompt");
  const agent = new Agent({
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
  await assert.rejects(() => agent.run("go"), /summary boom/);
  assert.deepEqual(agent.export()[agent.export().length - 1], { role: "tool", tool_call_id: "t1", content: "(interrupted)" });
});
