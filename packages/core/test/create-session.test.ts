import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/create-session.js";
import { SPOOL_RETENTION_MS } from "../src/util/constants.js";

const llm = { baseUrl: "http://localhost:1", apiKey: "test", model: "test" };

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "create-session-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function startSession(sessionDir: string | undefined, toolSpoolDir: string | undefined, sessionId: string): Promise<void> {
  const session = await createSession({ systemPrompt: "test", llm, builtInTools: false, sessionDir, toolSpoolDir, sessionId });
  session.dispose();
}

test("a new session sweeps both directories but keeps its own files", async () => {
  await withDir(async (dir) => {
    const sessionDir = join(dir, "projects");
    const spoolDir = join(dir, "tool-output");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(spoolDir, { recursive: true });
    const past = new Date(Date.now() - SPOOL_RETENTION_MS - 60_000);
    for (const path of [join(sessionDir, "old.jsonl"), join(spoolDir, "old.notes.md")]) {
      await writeFile(path, "x", "utf-8");
      await utimes(path, past, past);
    }
    for (const path of [join(sessionDir, "s1.jsonl"), join(spoolDir, "s1.notes.md")]) {
      await writeFile(path, "x", "utf-8");
    }

    await startSession(sessionDir, spoolDir, "s1");

    assert.deepEqual(await readdir(sessionDir), ["s1.jsonl"]);
    assert.deepEqual(await readdir(spoolDir), ["s1.notes.md"]);
  });
});

test("a new session tolerates a missing spool directory", async () => {
  await withDir(async (dir) => {
    const stale = join(dir, "old.jsonl");
    await writeFile(stale, "x", "utf-8");
    const past = new Date(Date.now() - SPOOL_RETENTION_MS - 60_000);
    await utimes(stale, past, past);

    await startSession(dir, undefined, "s1");

    assert.deepEqual(await readdir(dir), []);
  });
});
