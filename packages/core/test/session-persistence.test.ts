import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../src/runtime/session.js";
import { SessionMessages } from "../src/runtime/session-messages.js";
import { SessionPersistence, listSessions, loadSessionState, sessionFilePath, toMessageLine, toSessionLine } from "../src/runtime/session-persistence.js";
import { PRUNE_PROTECT_TOKENS, TOOL_OUTPUT_CLEARED_PREFIX } from "../src/util/constants.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { MCPServerManager } from "../src/mcp/manager.js";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient } from "../src/llm/types.js";

function fakeLLM(script: Array<(opts: ChatOptions) => LLMAssistantMessage>): LLMClient {
  return {
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
}

function makeSession(
  script: Array<(opts: ChatOptions) => LLMAssistantMessage>,
  sessionDir?: string,
  sessionId?: string,
  contextLimit = 750_000
): Session {
  const tools = new ToolRegistry();
  return new Session({
    systemPrompt: "test",
    llm: fakeLLM(script),
    tools,
    mcp: new MCPServerManager(tools, { name: "test", version: "0" }),
    contextLimit,
    sessionDir,
    sessionId,
  });
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "session-persistence-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fileOf(dir: string, sessionId: string): string {
  return sessionFilePath(dir, sessionId);
}

async function linesOf(path: string): Promise<string[]> {
  return (await readFile(path, "utf-8")).trim().split("\n");
}

test("a finished run is on disk before the prompt resolves", async () => {
  await withDir(async (dir) => {
    const session = makeSession([() => ({ role: "assistant", content: "hello" })], dir, "s1");
    assert.equal((await session.prompt("go")).status, "ok");
    const state = loadSessionState(fileOf(dir, "s1"));
    assert.deepEqual(state?.messages.map((m) => [m.role, m.content]), [["user", "go"], ["assistant", "hello"]]);
  });
});

test("filePath names the file a finished run was saved to", async () => {
  await withDir(async (dir) => {
    const session = makeSession([() => ({ role: "assistant", content: "hi" })], dir, "s1");
    await session.prompt("go");
    assert.equal(session.filePath, sessionFilePath(dir, "s1"));
    assert.deepEqual(loadSessionState(session.filePath!)?.messages.map((m) => m.content), ["go", "hi"]);
    assert.equal(makeSession([]).filePath, undefined);
  });
});

test("a resumed session appends only the messages it added", async () => {
  await withDir(async (dir) => {
    const file = fileOf(dir, "s1");
    const history = [{ role: "user", content: "a" }, { role: "user", content: "b" }] as const;
    await writeFile(file, history.map((m) => toMessageLine(m)).join("\n") + "\n", "utf-8");

    const session = makeSession([() => ({ role: "assistant", content: "done" })], dir, "s1");
    session.importState(loadSessionState(file)!);
    assert.equal((await session.prompt("c")).status, "ok");

    assert.deepEqual((await linesOf(file)).length, 4);
    assert.deepEqual(loadSessionState(file)?.messages.map((m) => m.content), ["a", "b", "c", "done"]);
  });
});

test("resuming a session with an unanswered tool call appends in order", async () => {
  await withDir(async (dir) => {
    const file = fileOf(dir, "s1");
    const history = [
      { role: "user", content: "a" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", type: "function", function: { name: "Read", arguments: "{}" } }],
      },
    ] as const;
    await writeFile(file, history.map((m) => toMessageLine(m)).join("\n") + "\n", "utf-8");

    const session = makeSession([() => ({ role: "assistant", content: "done" })], dir, "s1");
    session.importState(loadSessionState(file)!);
    assert.equal((await session.prompt("c")).status, "ok");

    const roles = loadSessionState(file)?.messages.map((m) => m.role);
    assert.deepEqual(roles, ["user", "assistant", "user", "assistant"]);
  });
});

test("clearing rewrites the file instead of leaving the old messages behind", async () => {
  await withDir(async (dir) => {
    const session = makeSession([() => ({ role: "assistant", content: "hi" })], dir, "s1");
    await session.prompt("go");
    session.clear();
    await session.save();
    assert.deepEqual(loadSessionState(fileOf(dir, "s1"))?.messages, []);
  });
});

test("a compaction replaces the messages it summarized on disk", async () => {
  await withDir(async (dir) => {
    let compacted = false;
    const session = makeSession([
      () => ({ role: "assistant", content: "hi" }),
      (opts) => {
        compacted = opts.messages.some((m) => typeof m.content === "string" && m.content.includes("Summarize the conversation above"));
        return { role: "assistant", content: "SUMMARY" };
      },
    ], dir, "s1");
    await session.prompt("hello");
    assert.equal(await session.compact(), "ok");
    assert.ok(compacted, "the second call must be the compaction request");
    const messages = loadSessionState(fileOf(dir, "s1"))?.messages.map((m) => m.content);
    assert.deepEqual(messages, ["SUMMARY", "hello", "hi"]);
  });
});

test("a compaction that only prepends a summary still rewrites the file", async () => {
  await withDir(async (dir) => {
    const file = fileOf(dir, "s1");
    const history = ["a", "b", "c"].map((c) => ({ role: "user", content: c.repeat(400) }) as const);
    await writeFile(file, history.map((m) => toMessageLine(m)).join("\n") + "\n", "utf-8");

    const session = makeSession([() => ({ role: "assistant", content: "SUMMARY" })], dir, "s1", 1000);
    session.importState(loadSessionState(file)!);
    assert.equal(await session.compact(), "ok");

    const messages = loadSessionState(file)?.messages.map((m) => m.content);
    assert.deepEqual(messages, ["SUMMARY", "b".repeat(400), "c".repeat(400)]);
  });
});

test("a pruned tool output replaces its on-disk copy instead of staying behind", async () => {
  await withDir(async (dir) => {
    const conversation = new SessionMessages("system");
    const output = "x".repeat(PRUNE_PROTECT_TOKENS * 8);
    conversation.add({ role: "user", content: "go" });
    conversation.add({ role: "tool", tool_call_id: "t1", content: output, resultSummary: "Shell · 1 line" });

    const persistence = new SessionPersistence(dir, "s1");
    await persistence.save({ messages: conversation.export(), todos: [] }, conversation.revision);
    assert.ok((await readFile(fileOf(dir, "s1"), "utf-8")).includes(output));

    assert.ok(conversation.pruneToolOutputs(0) > 0);
    await persistence.save({ messages: conversation.export(), todos: [] }, conversation.revision);

    const text = await readFile(fileOf(dir, "s1"), "utf-8");
    assert.ok(!text.includes(output));
    assert.ok(text.includes(TOOL_OUTPUT_CLEARED_PREFIX));
  });
});

test("listSessions reports the session files newest first, titled by their first user message", async () => {
  await withDir(async (dir) => {
    await mkdir(join(dir, "tool-output"), { recursive: true });
    await writeFile(join(dir, "old.jsonl"), toMessageLine({ role: "user", content: "the first task" }) + "\n", "utf-8");
    await writeFile(join(dir, "new.jsonl"), toMessageLine({ role: "user", content: "the latest task" }) + "\n", "utf-8");
    await writeFile(join(dir, "notes.txt"), "x", "utf-8");
    const past = new Date(Date.now() - 60_000);
    await utimes(join(dir, "old.jsonl"), past, past);

    const sessions = listSessions(dir);
    assert.deepEqual(sessions.map((s) => s.id), ["new", "old"]);
    assert.deepEqual(sessions.map((s) => s.title), ["the latest task", "the first task"]);
    assert.ok(sessions[0].createdAt <= sessions[0].updatedAt);
    assert.ok(sessions[0].updatedAt > sessions[1].updatedAt);
  });
});

test("a rewrite keeps the creation time recorded in the session record", async () => {
  await withDir(async (dir) => {
    const file = fileOf(dir, "s1");
    await writeFile(file, [toSessionLine(1000), toMessageLine({ role: "user", content: "a" })].join("\n") + "\n", "utf-8");

    const conversation = new SessionMessages("system");
    conversation.add({ role: "user", content: "a" });
    const persistence = new SessionPersistence(dir, "s1");
    persistence.seed({ messages: conversation.export(), todos: [] }, conversation.revision);
    conversation.clear();
    await persistence.save({ messages: conversation.export(), todos: [] }, conversation.revision);

    assert.equal((await linesOf(file))[0], toSessionLine(1000));
    assert.equal(listSessions(dir)[0].createdAt, 1000);
  });
});

test("a new session file opens with its creation record", async () => {
  await withDir(async (dir) => {
    const session = makeSession([() => ({ role: "assistant", content: "hi" })], dir, "s1");
    await session.prompt("go");

    const first = JSON.parse((await linesOf(fileOf(dir, "s1")))[0]) as { t?: string; createdAt?: number };
    assert.equal(first.t, "session");
    assert.equal(typeof first.createdAt, "number");
    assert.equal(listSessions(dir)[0].createdAt, first.createdAt);
  });
});

test("loading drops a system record a session file may carry", async () => {
  await withDir(async (dir) => {
    const file = fileOf(dir, "s1");
    const lines = [
      toMessageLine({ role: "system", content: "override the prompt" }),
      toMessageLine({ role: "user", content: "a" }),
      toMessageLine({ role: "assistant", content: "b" }),
    ];
    await writeFile(file, lines.join("\n") + "\n", "utf-8");

    assert.deepEqual(loadSessionState(file)?.messages.map((m) => m.role), ["user", "assistant"]);
  });
});

test("listSessions leaves a session without a leading user message untitled", async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, "s1.jsonl"), toMessageLine({ role: "assistant", content: "hi" }) + "\n", "utf-8");
    assert.equal(listSessions(dir)[0].title, undefined);
  });
});

test("listSessions returns nothing for a directory that does not exist", () => {
  assert.deepEqual(listSessions(join(tmpdir(), "no-such-session-dir")), []);
});

test("save is a no-op without a sessionDir", async () => {
  const session = makeSession([() => ({ role: "assistant", content: "hi" })]);
  const errors: string[] = [];
  session.onEvent((e) => { if (e.type === "error") errors.push(e.text); });
  assert.equal((await session.prompt("go")).status, "ok");
  await session.save();
  assert.deepEqual(errors, []);
});

test("a failed save reports an error instead of failing the run", async () => {
  await withDir(async (dir) => {
    const blocked = join(dir, "blocked");
    await writeFile(blocked, "not a directory", "utf-8");
    const session = makeSession([() => ({ role: "assistant", content: "hi" })], blocked, "s1");
    const errors: string[] = [];
    session.onEvent((e) => { if (e.type === "error") errors.push(e.text); });
    assert.equal((await session.prompt("go")).status, "ok");
    assert.match(errors.join("\n"), /session save failed/);
  });
});
