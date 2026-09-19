import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupScratchDir } from "../src/util/scratch.js";
import { SCRATCH_RETENTION_MS } from "../src/util/constants.js";

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "scratch-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cleanup removes files past the retention window and keeps recent ones", async () => {
  await withDir(async (dir) => {
    const stale = join(dir, "stale.txt");
    await writeFile(stale, "old", "utf-8");
    await writeFile(join(dir, "fresh.txt"), "new", "utf-8");
    const past = new Date(Date.now() - SCRATCH_RETENTION_MS - 60_000);
    await utimes(stale, past, past);

    await cleanupScratchDir(dir);
    assert.deepEqual(await readdir(dir), ["fresh.txt"]);
  });
});

test("cleanup never removes the excluded file", async () => {
  await withDir(async (dir) => {
    const past = new Date(Date.now() - SCRATCH_RETENTION_MS - 60_000);
    await writeFile(join(dir, "kept.txt"), "old", "utf-8");
    await writeFile(join(dir, "stale.txt"), "old", "utf-8");
    await utimes(join(dir, "kept.txt"), past, past);
    await utimes(join(dir, "stale.txt"), past, past);

    await cleanupScratchDir(dir, "kept.txt");
    assert.deepEqual(await readdir(dir), ["kept.txt"]);
  });
});

test("cleanup keeps every file while the directory is under the size cap", async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, "a.txt"), "a", "utf-8");
    await writeFile(join(dir, "b.txt"), "b", "utf-8");

    await cleanupScratchDir(dir);
    assert.equal((await readdir(dir)).length, 2);
  });
});

test("cleanup ignores subdirectories and tolerates a missing directory", async () => {
  await withDir(async (dir) => {
    await mkdir(join(dir, "nested"));

    await cleanupScratchDir(dir);
    assert.deepEqual(await readdir(dir), ["nested"]);
    await cleanupScratchDir(join(dir, "does-not-exist"));
  });
});
