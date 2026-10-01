import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { globTool } from "../src/tools/glob.js";

async function withDir(files: Array<[string, number] | string>, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "glob-test-"));
  try {
    for (const entry of files) {
      const path = join(dir, typeof entry === "string" ? entry : entry[0]);
      await mkdir(dirname(path), { recursive: true });
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

test("glob caps results and reports the total", async () => {
  const files = Array.from({ length: 255 }, (_, i) => `f${String(i).padStart(3, "0")}.txt`);
  await withDir(files, async (dir) => {
    const out = await glob({ path: dir }, dir);
    const lines = out.split("\n").filter(Boolean);
    assert.equal(lines.length, 252);
    assert.equal(lines[250], "(output truncated) 255 files in total, showing the first 250");
    assert.equal(lines[251], "by directory: . = 255");
  });
});

test("glob reports the per-directory distribution of a truncated listing", async () => {
  const files = [
    ...Array.from({ length: 200 }, (_, i) => `a/f${i}.java`),
    ...Array.from({ length: 105 }, (_, i) => `b/f${i}.java`),
    ...Array.from({ length: 5 }, (_, i) => `b/c/f${i}.java`),
  ];
  await withDir(files, async (dir) => {
    const out = await glob({ path: dir, pattern: "**/*.java" }, dir);
    const lines = out.split("\n").filter(Boolean);
    assert.equal(lines[250], "(output truncated) 310 files in total, showing the first 250");
    assert.match(lines[251], /^by directory: /);
    assert.match(lines[251], /\bb = 105\b/);
    assert.match(lines[251], /\bb\/c = 5\b/);
  });
});

test("glob caps the per-directory census and reports how many directories are hidden", async () => {
  const dirs = Array.from({ length: 45 }, (_, d) => `d${String(d).padStart(2, "0")}`);
  const files = dirs.flatMap((d) => Array.from({ length: 7 }, (_, f) => `${d}/f${f}.java`));
  await withDir(files, async (dir) => {
    const lines = (await glob({ path: dir, pattern: "**/*.java" }, dir)).split("\n").filter(Boolean);
    assert.equal(lines[250], "(output truncated) 315 files in total, showing the first 250");
    const census = lines[251];
    assert.match(census, /\(40 of 45 directories shown, largest first — narrow with path or pattern for the rest\)$/);
    assert.equal(census.slice(0, census.indexOf(" (")).split(", ").length, 40);
  });
});

test("glob without matches lists nothing", async () => {
  await withDir(["a.ts"], async (dir) => {
    const out = await glob({ path: dir, pattern: "**/*.js" }, dir);
    assert.equal(out, "(no matches)");
  });
});

test("glob offset walks a listing in the same order as the pages before it", async () => {
  const now = Math.floor(Date.now() / 1000);
  await withDir([["a.txt", now - 3 * 86400], ["b.txt", now - 86400], ["c.txt", now - 2 * 86400]], async (dir) => {
    assert.equal(await glob({ path: dir }, dir), "b.txt\nc.txt\na.txt");
    assert.equal(await glob({ path: dir, offset: 2 }, dir), "a.txt");
  });
});

test("glob offset pages a capped listing and reports the shown range", async () => {
  const files = Array.from({ length: 510 }, (_, i) => `f${String(i).padStart(3, "0")}.txt`);
  await withDir(files, async (dir) => {
    const lines = (await glob({ path: dir, offset: 250 }, dir)).split("\n").filter(Boolean);
    assert.equal(lines.length, 252);
    assert.equal(lines[250], "(output truncated) 510 files in total, showing 251-500");
    assert.equal(lines[251], "by directory: . = 510");
  });
});

test("glob offset past the end reports no entries instead of no matches", async () => {
  await withDir(["a.txt"], async (dir) => {
    assert.equal(await glob({ path: dir, offset: 5 }, dir), "(no entries at offset 5 — end of results)");
  });
});
