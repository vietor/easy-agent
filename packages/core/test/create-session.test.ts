import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt, createSession } from "../src/create-session.js";
import { DIR_RETENTION_MS } from "../src/util/constants.js";
import type { MCPServerConfig } from "../src/mcp/types.js";
import { fakeLLM } from "./helpers.js";

const llm = { baseUrl: "http://localhost:1", apiKey: "test", model: "test" };

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "create-session-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function startSession(sessionDir: string | undefined, scratchDir: string | undefined, sessionId: string): Promise<void> {
  const session = await createSession({ systemPrompt: "test", llm, builtInTools: false, sessionDir, scratchDir, sessionId });
  session.dispose();
}

test("a new session sweeps the session directory and clears the scratch directory", async () => {
  await withDir(async (dir) => {
    const sessionDir = join(dir, "projects");
    const scratchDir = join(dir, "scratch");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(join(scratchDir, "nested"), { recursive: true });
    await writeFile(join(scratchDir, "nested", "deep.txt"), "x", "utf-8");
    const past = new Date(Date.now() - DIR_RETENTION_MS - 60_000);
    for (const path of [join(sessionDir, "old.jsonl"), join(scratchDir, "stale.txt")]) {
      await writeFile(path, "x", "utf-8");
      await utimes(path, past, past);
    }
    for (const path of [join(sessionDir, "s1.jsonl"), join(scratchDir, "notes.md")]) {
      await writeFile(path, "x", "utf-8");
    }

    await startSession(sessionDir, scratchDir, "s1");

    assert.deepEqual(await readdir(sessionDir), ["s1.jsonl"]);
    assert.deepEqual(await readdir(scratchDir).catch(() => []), [], "scratch is cleared whole, even the live session's own files");
  });
});

test("creating a session does not wait for MCP servers to connect", async () => {
  const servers: Record<string, MCPServerConfig> = { slow: { type: "stdio", command: "node", args: ["-e", "setTimeout(() => {}, 5000)"] } };
  const started = Date.now();
  const session = await createSession({ systemPrompt: "test", llm, builtInTools: false, mcpServers: servers });
  assert.ok(Date.now() - started < 2000);
  session.dispose();
});

test("a new session tolerates a missing scratch directory", async () => {
  await withDir(async (dir) => {
    const stale = join(dir, "old.jsonl");
    await writeFile(stale, "x", "utf-8");
    const past = new Date(Date.now() - DIR_RETENTION_MS - 60_000);
    await utimes(stale, past, past);

    await startSession(dir, undefined, "s1");

    assert.deepEqual(await readdir(dir), []);
  });
});

test("refuses a session id that would escape its directory", async () => {
  for (const sessionId of ["", ".", "..", "../escape", "a/b", "a\\b"]) {
    await assert.rejects(
      () => createSession({ systemPrompt: "test", llm, builtInTools: false, sessionId }),
      /sessionId must be a single path segment/,
      `sessionId ${JSON.stringify(sessionId)} must be refused`
    );
  }
});

test("refuses an llm config whose output budget leaves no context room", async () => {
  await assert.rejects(
    () => createSession({ systemPrompt: "test", llm: { ...llm, maxInputTokens: 128_000, maxOutputTokens: 128_000 }, builtInTools: false }),
    /maxOutputTokens must be less than maxInputTokens/
  );
});

test("the sub-agent guidance advertises the effective concurrency budget", () => {
  const limits = { maxTurns: 50, maxParallelToolCalls: 10, maxSubAgentTurns: 50 };
  const opts = { systemPrompt: "test", llm, builtInTools: { subAgent: true } };
  assert.match(buildSystemPrompt("base", opts, limits), /issue at most 4 SubAgent calls per turn/);
  assert.match(buildSystemPrompt("base", { ...opts, maxConcurrentSubAgents: 2 }, limits), /issue at most 2 SubAgent calls per turn/);
});

test("an injected LLM client is used as-is", async () => {
  const { llm: fake, calls } = fakeLLM([
    (opts) => {
      opts.onDelta?.("hello");
      return { role: "assistant", content: "hello" };
    },
  ]);
  const session = await createSession({ systemPrompt: "sys", llm: fake, builtInTools: false });
  assert.equal(session.model, "fake");
  assert.equal(session.thinkingEffort, "high");
  assert.equal(session.contextLimit, 72_000);

  const result = await session.prompt("hi");
  session.dispose();

  assert.equal(result.status, "ok");
  assert.equal(result.reply, "hello");
  const system = calls[0].messages[0];
  assert.equal(system.role, "system");
  assert.ok(typeof system.content === "string" && system.content.includes("sys"));
});
