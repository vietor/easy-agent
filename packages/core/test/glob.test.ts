import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globTool } from "../src/tools/glob.js";

async function withDir(files: Array<[string, number] | string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "glob-test-"));
  try {
    for (const entry of files) {
      const path = join(dir, typeof entry === "string" ? entry : entry[0]);
      await writeFile(path, "", "utf-8");
      if (typeof entry !== "string") await utimes(path, entry[1], entry[1]);
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function glob(args: Record<string, unknown>, cwd: string): Promise<string> {
  return globTool.execute(args, { cwd }).then((r) => r.content);
}

test("glob sorts results by mtime, newest first", async () => {
  const now = Math.floor(Date.now() / 1000);
  await withDir([["a.txt", now - 3 * 86400], ["b.txt", now - 86400], ["c.txt", now - 2 * 86400]], async (dir) => {
    const out = await glob({ path: dir }, dir);
    assert.equal(out, "b.txt\nc.txt\na.txt");
  });
});

test("glob caps results with a truncation marker", async () => {
  const files = Array.from({ length: 155 }, (_, i) => `f${String(i).padStart(3, "0")}.txt`);
  await withDir(files, async (dir) => {
    const out = await glob({ path: dir }, dir);
    const lines = out.split("\n").filter(Boolean);
    assert.equal(lines.length, 151);
    assert.equal(lines[150], "(output truncated)");
  });
});

test("glob without matches lists nothing", async () => {
  await withDir(["a.ts"], async (dir) => {
    const out = await glob({ path: dir, pattern: "**/*.js" }, dir);
    assert.equal(out, "(no matches)");
  });
});
