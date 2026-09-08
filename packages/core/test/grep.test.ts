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

test("grep offset pages past the first page of results", async () => {
  await withFile("alpha\nbeta\nalpha\nalpha\n", async (p) => {
    const out = await grep({ pattern: "alpha", path: p, head_limit: 2, offset: 2 }, process.cwd());
    assert.equal(out, `${p.replace(/\\/g, "/")}:4:alpha`);
  });
});

test("grep offset across files is deterministic with sorted paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "grep-paging-"));
  try {
    await writeFile(join(dir, "a.txt"), "alpha\nalpha\n", "utf-8");
    await writeFile(join(dir, "b.txt"), "alpha\nalpha\n", "utf-8");
    const out = await grep({ pattern: "alpha", path: dir, head_limit: 10, offset: 1 }, process.cwd());
    assert.equal(out, "a.txt:2:alpha\nb.txt:1:alpha\nb.txt:2:alpha");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("grep offset past the end reports no entries instead of no matches", async () => {
  await withFile("alpha\nalpha\n", async (p) => {
    const out = await grep({ pattern: "alpha", path: p, head_limit: 2, offset: 2 }, process.cwd());
    assert.equal(out, "(no entries at offset 2 — end of results)");
  });
});

test("grep rejects offset outside content mode", async () => {
  await withFile("alpha\n", async (p) => {
    await assert.rejects(
      grepTool.execute({ pattern: "alpha", path: p, output_mode: "count", offset: 1 }, process.cwd()),
      /offset is only supported with output_mode=content/
    );
  });
});

test("grep validates offset", async () => {
  await withFile("alpha\n", async (p) => {
    await assert.rejects(
      grepTool.execute({ pattern: "alpha", path: p, offset: -1 }, process.cwd()),
      /offset must be a non-negative integer/
    );
  });
});
