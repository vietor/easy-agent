import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileWriteTool } from "../src/tools/file-write.js";

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "write-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("write creates a file and its parent directories", async () => {
  await withDir(async (dir) => {
    const result = await fileWriteTool.execute({ path: "nested/a.txt", content: "one" }, { cwd: dir });
    assert.equal(result.content, "Wrote nested/a.txt (no need to Read it back — the file is current)");
    assert.equal(await readFile(join(dir, "nested", "a.txt"), "utf-8"), "one");
  });
});

test("write overwrites by default and appends when append is set", async () => {
  await withDir(async (dir) => {
    await fileWriteTool.execute({ path: "a.txt", content: "one" }, { cwd: dir });
    await fileWriteTool.execute({ path: "a.txt", content: "two" }, { cwd: dir });
    assert.equal(await readFile(join(dir, "a.txt"), "utf-8"), "two");

    const result = await fileWriteTool.execute({ path: "a.txt", content: "three", append: true }, { cwd: dir });
    assert.equal(result.content, "Appended to a.txt (no need to Read it back — the file is current)");
    assert.equal(await readFile(join(dir, "a.txt"), "utf-8"), "twothree");
  });
});

test("write append creates the file and its parent directories", async () => {
  await withDir(async (dir) => {
    await fileWriteTool.execute({ path: "nested/a.txt", content: "one", append: true }, { cwd: dir });
    assert.equal(await readFile(join(dir, "nested", "a.txt"), "utf-8"), "one");
  });
});

test("write rejects a non-boolean append", async () => {
  await withDir(async (dir) => {
    await assert.rejects(
      fileWriteTool.execute({ path: "a.txt", content: "x", append: "true" }, { cwd: dir }),
      /append must be a boolean/
    );
  });
});
