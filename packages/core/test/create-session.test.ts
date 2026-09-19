import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/create-session.js";
import { SCRATCH_RETENTION_MS } from "../src/util/constants.js";

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

test("a new session sweeps both directories but keeps its own files", async () => {
  await withDir(async (dir) => {
    const sessionDir = join(dir, "projects");
    const scratchDir = join(dir, "scratch");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(scratchDir, { recursive: true });
    const past = new Date(Date.now() - SCRATCH_RETENTION_MS - 60_000);
    for (const path of [join(sessionDir, "old.jsonl"), join(scratchDir, "old.notes.md")]) {
      await writeFile(path, "x", "utf-8");
      await utimes(path, past, past);
    }
    for (const path of [join(sessionDir, "s1.jsonl"), join(scratchDir, "s1.notes.md")]) {
      await writeFile(path, "x", "utf-8");
    }

    await startSession(sessionDir, scratchDir, "s1");

    assert.deepEqual(await readdir(sessionDir), ["s1.jsonl"]);
    assert.deepEqual(await readdir(scratchDir), ["s1.notes.md"]);
  });
});

test("a new session tolerates a missing scratch directory", async () => {
  await withDir(async (dir) => {
    const stale = join(dir, "old.jsonl");
    await writeFile(stale, "x", "utf-8");
    const past = new Date(Date.now() - SCRATCH_RETENTION_MS - 60_000);
    await utimes(stale, past, past);

    await startSession(dir, undefined, "s1");

    assert.deepEqual(await readdir(dir), []);
  });
});
