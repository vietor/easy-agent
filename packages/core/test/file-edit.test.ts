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
    assert.equal(
      await edit(p, { old_string: "beta", new_string: "BETA" }),
      `Edited ${p}. Changed region (cat -n format):\n1\talpha\n2\tBETA\n3\tgamma\n4\t\n(no need to Read it back — the region above is current)`
    );
    assert.equal(await readFile(p, "utf-8"), "alpha\nBETA\ngamma\n");
  });
});

test("an LF old_string matches a CRLF file and keeps CRLF endings", async () => {
  await withFile("alpha\r\nbeta\r\ngamma\r\n", async (p) => {
    assert.equal(
      await edit(p, { old_string: "beta\ngamma", new_string: "BETA\nGAMMA" }),
      `Edited ${p}. Changed region (cat -n format):\n1\talpha\n2\tBETA\n3\tGAMMA\n4\t\n(no need to Read it back — the region above is current)`
    );
    assert.equal(await readFile(p, "utf-8"), "alpha\r\nBETA\r\nGAMMA\r\n");
  });
});

test("replace_all converts a multi-line old_string for every occurrence", async () => {
  await withFile("a\r\nb\r\na\r\nb\r\n", async (p) => {
    assert.equal(
      await edit(p, { old_string: "a\nb", new_string: "X", replace_all: true }),
      `Edited ${p} (replaced all). Changed region (cat -n format):\n1\tX\n2\tX\n3\t\n(no need to Read it back — the region above is current)`
    );
    assert.equal(await readFile(p, "utf-8"), "X\r\nX\r\n");
  });
});

test("the snippet shows three lines of context around the change with padded line numbers", async () => {
  const body = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
  await withFile(body, async (p) => {
    assert.equal(
      await edit(p, { old_string: "line7", new_string: "LINE7" }),
      `Edited ${p}. Changed region (cat -n format):\n 4\tline4\n 5\tline5\n 6\tline6\n 7\tLINE7\n 8\tline8\n 9\tline9\n10\tline10\n(no need to Read it back — the region above is current)`
    );
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
