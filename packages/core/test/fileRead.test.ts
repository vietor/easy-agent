import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileReadTool } from "../src/tools/fileRead.js";

const LINES = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");

async function withFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fileRead-test-"));
  try {
    const path = join(dir, "f.txt");
    await writeFile(path, content, "utf-8");
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function read(path: string, args: Record<string, unknown> = {}): Promise<string> {
  return fileReadTool
    .execute({ path, ...args }, { cwd: process.cwd() })
    .then((r) => (typeof r === "string" ? r : r.content));
}

function numbered(lines: string[], start: number): string {
  return lines.map((l, i) => `${String(start + i).padStart(6, " ")}\t${l}`).join("\n");
}

test("reads a page with line numbers", async () => {
  await withFile(LINES, async (p) => {
    const out = await read(p, { offset: 4, limit: 3 });
    assert.equal(out, numbered(["line4", "line5", "line6"], 4) + "\n(more lines; use offset=7 to continue)");
  });
});

test("full read reaches EOF and omits the continuation hint", async () => {
  await withFile(LINES, async (p) => {
    assert.equal(await read(p), numbered(LINES.split("\n"), 1));
  });
});

test("offset past end reports the exact line count", async () => {
  await withFile(LINES, async (p) => {
    assert.equal(await read(p, { offset: 50 }), "(offset 50 is past end of file; file has 10 lines)");
  });
});

test("trailing newline yields the final empty line", async () => {
  await withFile("a\nb\n", async (p) => {
    assert.equal(await read(p), numbered(["a", "b", ""], 1));
  });
});

test("single line without trailing newline", async () => {
  await withFile("hello", async (p) => {
    assert.equal(await read(p), numbered(["hello"], 1));
  });
});

test("empty file", async () => {
  await withFile("", async (p) => {
    assert.equal(await read(p), "(empty file)");
  });
});

test("rejects files over the size limit", async () => {
  await withFile("", async (p) => {
    await writeFile(p, Buffer.alloc(21 * 1024 * 1024));
    await assert.rejects(() => read(p), /larger than the 20M read limit/);
  });
});
