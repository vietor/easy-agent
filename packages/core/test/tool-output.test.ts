import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/runtime/agent.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { runSubAgent } from "../src/runtime/sub-agent-runner.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient } from "../src/llm/types.js";
import type { Tool } from "../src/tools/types.js";

const BIG = Array.from({ length: 10_000 }, (_, i) => `line ${i} ${"x".repeat(24)}`).join("\n");

function fakeLLM(script: Array<(opts: ChatOptions) => LLMAssistantMessage>) {
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
  return { llm };
}

function toolCall(name: string, args = "{}", id = "t1"): LLMAssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}

function stub(name: string, content: string, truncate?: "head" | "tail"): Tool {
  return {
    name,
    agentLevel: 2,
    description: name,
    parameters: { type: "object", properties: {} },
    truncate,
    async execute() {
      return { content };
    },
  };
}

function makeAgent(llm: LLMClient, tools: Tool[], toolSpoolDir?: string, contextLimit = 750_000): Agent {
  const registry = new ToolRegistry();
  registry.registerAll(tools);
  return new Agent({
    llm,
    conversation: new SessionMessages("system prompt"),
    tools: registry,
    cwd: process.cwd(),
    setTodos: () => {},
    getTodos: () => [],
    stallThreshold: 3,
    maxTurns: 50,
    maxParallelToolCalls: 10,
    contextLimit,
    toolSpoolDir,
  });
}

async function withToolSpoolDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tool-output-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function toolMessage(agent: Agent) {
  const message = agent.export().find((m) => m.role === "tool");
  assert.ok(message, "tool result must be in the conversation");
  return message;
}

async function runWith(tool: Tool, toolSpoolDir?: string) {
  const { llm } = fakeLLM([() => toolCall(tool.name), () => ({ role: "assistant", content: "done" })]);
  const agent = makeAgent(llm, [tool], toolSpoolDir);
  assert.equal(await agent.run("go"), "ok");
  return toolMessage(agent);
}

test("oversized output passes through untouched when no spool directory is configured", async () => {
  const message = await runWith(stub("Big", BIG));
  assert.equal(message.content, BIG);
  assert.ok(!message.resultSummary?.includes("truncated"));
});

test("oversized output is truncated and the spooled file holds the complete text", async () => {
  await withToolSpoolDir(async (dir) => {
    const message = await runWith(stub("Big", BIG), dir);
    assert.ok(message.content.length < BIG.length, "content must be truncated");
    assert.match(message.content, /^line 0 /, "head truncation keeps the start");
    assert.match(message.content, /Full output saved to: /);
    assert.match(message.resultSummary ?? "", /truncated, full output: /);

    const saved = (await readdir(dir)).filter((name) => name.endsWith(".txt"));
    assert.equal(saved.length, 1, "exactly one spool file");
    assert.equal(await readFile(join(dir, saved[0]), "utf-8"), BIG);
  });
});

test("a failing spool write degrades to an untruncated result", async () => {
  await withToolSpoolDir(async (dir) => {
    const blocked = join(dir, "blocked");
    await writeFile(blocked, "not a directory", "utf-8");
    const message = await runWith(stub("Big", BIG), blocked);
    assert.equal(message.content, BIG);
    assert.ok(!message.resultSummary?.includes("truncated"));
  });
});

test("shell output keeps its tail rather than its head", async () => {
  await withToolSpoolDir(async (dir) => {
    const content = `START_MARKER\n${"y".repeat(BIG.length)}\nEND_MARKER`;
    const message = await runWith(stub("Shell", content, "tail"), dir);
    assert.match(message.content, /END_MARKER/);
    assert.ok(!message.content.includes("START_MARKER"));
  });
});

test("old tool output is cleared once the context approaches its limit", async () => {
  await withToolSpoolDir(async (dir) => {
    const script = Array.from({ length: 10 }, (_, i) => () => toolCall("Big", `{"n":${i}}`, `t${i}`));
    script.push(() => ({ role: "assistant", content: "done" }));
    const { llm } = fakeLLM(script);
    const notices: string[] = [];
    const agent = makeAgent(llm, [stub("Big", BIG)], dir, 60_000);

    assert.equal(await agent.run("go", (e) => { if (e.type === "notice") notices.push(e.text); }), "ok");
    assert.match(notices.join("\n"), /cleared .* tokens of old tool output/);
    const toolMessages = agent.export().filter((m) => m.role === "tool");
    assert.ok(toolMessages.some((m) => m.content.startsWith("(output cleared: ")), "old output must be cleared");
    assert.ok(toolMessages.at(-1)!.content.includes("Full output saved to: "), "recent output must survive");
  });
});

test("the line cap truncates even when the byte cap would not", async () => {
  await withToolSpoolDir(async (dir) => {
    const lines = Array.from({ length: 3000 }, (_, i) => `L${i}`).join("\n");
    assert.ok(lines.length < 50 * 1024, "fixture must stay under the byte cap");

    const message = await runWith(stub("Big", lines), dir);
    assert.match(message.content, /^L0\nL1\n/);
    assert.ok(message.content.includes("\nL1999"), "the 2000th line must survive");
    assert.ok(!message.content.includes("L2999"), "lines past the cap must be dropped");
    assert.match(message.content, /showing the first 2000 of 3000 lines/);
  });
});

test("the line cap keeps the final lines for a tail-truncated tool", async () => {
  await withToolSpoolDir(async (dir) => {
    const lines = Array.from({ length: 3000 }, (_, i) => `L${i}`).join("\n");

    const message = await runWith(stub("Big", lines, "tail"), dir);
    assert.match(message.content, /L2999$/);
    assert.ok(!message.content.includes("\nL999\n"), "lines before the cap must be dropped");
    assert.match(message.content, /showing the last 2000 of 3000 lines/);
  });
});

test("sub-agents inherit the spool directory", async () => {
  await withToolSpoolDir(async (dir) => {
    let system = "";
    const { llm } = fakeLLM([
      (opts) => {
        system = String(opts.messages[0].content);
        return toolCall("Big");
      },
      () => ({ role: "assistant", content: "done" }),
    ]);
    const tools = new ToolRegistry();
    tools.registerAll([stub("Big", BIG)]);
    const result = await runSubAgent(
      {
        llm,
        tools,
        cwd: process.cwd(),
        maxTurns: 50,
        stallThreshold: 3,
        maxParallelToolCalls: 10,
        contextLimit: 750_000,
        toolSpoolDir: dir,
      },
      "system prompt",
      "task",
      2
    );
    assert.equal(result.status, "ok");
    assert.match(system, /Oversized tool output is truncated/);
    assert.equal((await readdir(dir)).filter((name) => name.endsWith(".txt")).length, 1);
  });
});
