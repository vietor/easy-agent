import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileEditTool } from "../src/tools/file-edit.js";

async function withFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "file-edit-test-"));
  try {
    const path = join(dir, "f.txt");
    await writeFile(path, content, "utf-8");
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function edit(path: string, args: Record<string, unknown>): Promise<string> {
  return fileEditTool
    .execute({ path, ...args }, { cwd: process.cwd() })
    .then((r) => (typeof r === "string" ? r : r.content));
}

test("replaces an exact match", async () => {
  await withFile("alpha\nbeta\ngamma\n", async (p) => {
    assert.equal(await edit(p, { old_string: "beta", new_string: "BETA" }), `Edited ${p}`);
    assert.equal(await readFile(p, "utf-8"), "alpha\nBETA\ngamma\n");
  });
});

test("an LF old_string matches a CRLF file and keeps CRLF endings", async () => {
  await withFile("alpha\r\nbeta\r\ngamma\r\n", async (p) => {
    assert.equal(await edit(p, { old_string: "beta\ngamma", new_string: "BETA\nGAMMA" }), `Edited ${p}`);
    assert.equal(await readFile(p, "utf-8"), "alpha\r\nBETA\r\nGAMMA\r\n");
  });
});

test("replace_all converts a multi-line old_string for every occurrence", async () => {
  await withFile("a\r\nb\r\na\r\nb\r\n", async (p) => {
    assert.equal(await edit(p, { old_string: "a\nb", new_string: "X", replace_all: true }), `Edited ${p} (replaced all)`);
    assert.equal(await readFile(p, "utf-8"), "X\r\nX\r\n");
  });
});

test("a multi-line old_string matching twice without replace_all is rejected", async () => {
  await withFile("a\r\nb\r\na\r\nb\r\n", async (p) => {
    await assert.rejects(() => edit(p, { old_string: "a\nb", new_string: "X" }), /appears 2 times/);
  });
});

test("a missing old_string reports not-found without CRLF advice", async () => {
  await withFile("alpha\r\nbeta\r\n", async (p) => {
    await assert.rejects(
      () => edit(p, { old_string: "nope\nx", new_string: "x" }),
      (e: unknown) => {
        const message = (e as Error).message;
        return message.includes("old_string not found") && !message.includes("CRLF");
      }
    );
  });
});
