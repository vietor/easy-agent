import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grepTool } from "../src/tools/grep.js";

async function withFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "grep-test-"));
  try {
    const path = join(dir, "f.txt");
    await writeFile(path, content, "utf-8");
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function grep(args: Record<string, unknown>, cwd: string): Promise<string> {
  return grepTool.execute(args, { cwd }).then((r) => (typeof r === "string" ? r : r.content));
}

test("grep a single file by path shows the full path prefix", async () => {
  await withFile("alpha\nbeta\nalpha\n", async (p) => {
    const out = await grep({ pattern: "alpha", path: p }, process.cwd());
    assert.equal(out, `${p.replace(/\\/g, "/")}:1:alpha\n${p.replace(/\\/g, "/")}:3:alpha`);
  });
});

test("grep a directory still works", async () => {
  await withFile("alpha\nbeta\n", async (p) => {
    const dir = join(p, "..");
    const out = await grep({ pattern: "beta", path: dir }, process.cwd());
    assert.match(out, /:2:beta$/);
  });
});
