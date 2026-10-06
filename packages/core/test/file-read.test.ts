import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileReadTool } from "../src/tools/file-read.js";

const LINES = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");

async function withFile(content: string | Uint8Array, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "file-read-test-"));
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

function readFull(path: string, args: Record<string, unknown> = {}, vision?: boolean) {
  return fileReadTool.execute({ path, ...args }, { cwd: process.cwd(), vision });
}

function numbered(lines: string[], start: number): string {
  const width = String(start + lines.length - 1).length;
  return lines.map((l, i) => `${String(start + i).padStart(width, " ")}\t${l}`).join("\n");
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
    await assert.rejects(() => read(p), /larger than the [\d.]+M read limit/);
  });
});

test("rejects binary files", async () => {
  await withFile("", async (p) => {
    await writeFile(p, Buffer.from([0x01, 0x02, 0x03, 0x00, 0x04]));
    await assert.rejects(() => read(p), /binary/);
  });
});

const IMAGE_FIXTURES: Array<[string, Buffer]> = [
  ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04])],
  ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])],
  ["image/gif", Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1")],
  ["image/webp", Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1")],
];

for (const [mimeType, bytes] of IMAGE_FIXTURES) {
  test(`reads a ${mimeType} file as image content`, async () => {
    await withFile(bytes, async (p) => {
      const result = await readFull(p);
      assert.equal(result.content, `Read image ${p} (${mimeType}, ${bytes.length} bytes)`);
      assert.equal(result.images?.length, 1);
      assert.equal(result.images?.[0].mimeType, mimeType);
      assert.deepEqual(Buffer.from(result.images![0].data, "base64"), bytes);
    });
  });
}

test("images ignore offset and limit", async () => {
  await withFile(IMAGE_FIXTURES[0][1], async (p) => {
    const result = await readFull(p, { offset: 5, limit: 1 });
    assert.equal(result.images?.length, 1);
  });
});

test("rejects images over the image read limit", async () => {
  await withFile("", async (p) => {
    await writeFile(p, Buffer.concat([IMAGE_FIXTURES[0][1], Buffer.alloc(4 * 1024 * 1024)]));
    await assert.rejects(() => read(p), /image is [\d.]+M — larger than the [\d.]+M image read limit/);
  });
});

test("a text-only model gets an image description without the image data", async () => {
  await withFile(IMAGE_FIXTURES[0][1], async (p) => {
    const result = await readFull(p, {}, false);
    assert.equal(result.images, undefined);
    assert.equal(result.content, `Read image ${p} (image/png, 12 bytes); image input is disabled for the current model`);
  });
});

test("pages across the 64KB chunk boundary", async () => {
  const LINE = "x".repeat(99);
  const content = Array.from({ length: 700 }, (_, i) => `${i + 1}: ${LINE}`).join("\n");
  await withFile(content, async (p) => {
    const page1 = await read(p, { offset: 1, limit: 500 });
    assert.equal(page1, numbered(content.split("\n").slice(0, 500), 1) + "\n(more lines; use offset=501 to continue)");
    const page2 = await read(p, { offset: 501, limit: 500 });
    assert.equal(page2, numbered(content.split("\n").slice(500), 501));
  });
});

test("a page spanning the 64KB chunk boundary concatenates correctly", async () => {
  const LINE = "x".repeat(99);
  const content = Array.from({ length: 700 }, (_, i) => `${i + 1}: ${LINE}`).join("\n");
  await withFile(content, async (p) => {
    const out = await read(p, { offset: 600, limit: 100 });
    assert.equal(out, numbered(content.split("\n").slice(599, 699), 600) + "\n(more lines; use offset=700 to continue)");
  });
});

test("rejects a non-string path", async () => {
  await withFile("x", async (p) => {
    await assert.rejects(() => read(p, { path: undefined }), /path is required/);
  });
});

test("rejects non-positive offset and limit", async () => {
  await withFile("x", async (p) => {
    await assert.rejects(() => read(p, { offset: 0 }), /offset must be a positive integer/);
    await assert.rejects(() => read(p, { offset: 2.5 }), /offset must be a positive integer/);
    await assert.rejects(() => read(p, { limit: 0 }), /limit must be a positive integer/);
  });
});

test("CRLF line endings are stripped from displayed lines", async () => {
  await withFile("a\r\nb\r\n", async (p) => {
    assert.equal(await read(p), numbered(["a", "b", ""], 1));
  });
});

test("line numbers are padded to the widest number in the page", async () => {
  const content = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join("\n");
  await withFile(content, async (p) => {
    const out = await read(p, { offset: 9, limit: 2 });
    assert.equal(out, numbered(["line9", "line10"], 9) + "\n(more lines; use offset=11 to continue)");
  });
});
