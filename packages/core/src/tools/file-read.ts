import { open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";
import { parseToolArgs, positiveInt, toToolParameters } from "./types.js";
import { imageMediaType, isBinaryContent } from "../util/file.js";
import { DEFAULT_FILE_READ_LIMIT, MAX_FILE_READ_MB, MAX_IMAGE_READ_MB, MAX_SUMMARY_LENGTH, mbToBytes } from "../util/constants.js";
import { formatCompactNumber, summarizeText, summaryBytes } from "../util/text.js";

const CHUNK = 64 * 1024;
const MAX_FILE_READ_BYTES = mbToBytes(MAX_FILE_READ_MB);
const MAX_IMAGE_READ_BYTES = mbToBytes(MAX_IMAGE_READ_MB);

const DESCRIPTION = `Read a file as UTF-8 text, returned with line numbers (cat -n format); png, jpeg, gif, and webp files are returned as image content instead. Reads up to ${DEFAULT_FILE_READ_LIMIT} lines; use offset and limit to page further. Files over the size limit and binary files are rejected.`;

const PATH_ERROR = "path is required";

const ReadArgs = z.object({
  path: z.string({ error: PATH_ERROR }).min(1, { error: PATH_ERROR }),
  offset: positiveInt("offset", "line number to start reading from (1-indexed)").default(1),
  limit: positiveInt("limit", `number of lines to read (default ${DEFAULT_FILE_READ_LIMIT})`).default(DEFAULT_FILE_READ_LIMIT),
});

type PageRead =
  | { text: string; eof: boolean }
  | { text: null; totalLines: number };

async function readPage(handle: FileHandle, offset: number, limit: number): Promise<PageRead> {
  const startLine = offset - 1;
  let newlines = 0;
  let windowStart = startLine === 0 ? 0 : -1;
  const pieces: Buffer[] = [];
  const buf = Buffer.allocUnsafe(CHUNK);
  let binaryChecked = false;
  for (;;) {
    const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
    if (bytesRead === 0) break;
    if (!binaryChecked) {
      if (isBinaryContent(buf, bytesRead)) {
        throw new Error(`file appears to be binary — only UTF-8 text files can be read`);
      }
      binaryChecked = true;
    }
    for (let from = 0; ; ) {
      const i = buf.indexOf(0x0a, from);
      if (i === -1 || i >= bytesRead) break;
      if (newlines === startLine - 1) windowStart = i + 1;
      newlines++;
      if (newlines === startLine + limit) {
        if (windowStart < i) pieces.push(Buffer.from(buf.subarray(windowStart, i)));
        return { text: Buffer.concat(pieces).toString("utf-8"), eof: false };
      }
      from = i + 1;
    }
    if (windowStart >= 0) {
      if (windowStart < bytesRead) pieces.push(Buffer.from(buf.subarray(windowStart, bytesRead)));
      windowStart = 0;
    }
  }
  const totalLines = newlines + 1;
  if (startLine >= totalLines) return { text: null, totalLines };
  return { text: Buffer.concat(pieces).toString("utf-8"), eof: true };
}

export const fileReadTool: Tool = {
  name: "Read",
  agentLevel: 1,
  concurrencySafe: true,
  persist: false,
  description: DESCRIPTION,
  parameters: toToolParameters(ReadArgs),
  async execute(args, ctx) {
    const { path, offset, limit } = parseToolArgs(ReadArgs, args);
    const handle = await open(resolve(ctx.cwd, path), "r");
    try {
      const { size } = await handle.stat();
      if (size > MAX_FILE_READ_BYTES) {
        throw new Error(`file is ${formatCompactNumber(size)} — larger than the ${formatCompactNumber(MAX_FILE_READ_BYTES)} read limit`);
      }
      if (size === 0) return { content: "(empty file)" };
      const head = Buffer.allocUnsafe(12);
      const { bytesRead } = await handle.read(head, 0, 12, 0);
      const mimeType = imageMediaType(head, bytesRead);
      if (mimeType) {
        if (size > MAX_IMAGE_READ_BYTES) {
          throw new Error(`image is ${formatCompactNumber(size)} — larger than the ${formatCompactNumber(MAX_IMAGE_READ_BYTES)} image read limit`);
        }
        const content = `Read image ${path} (${mimeType}, ${formatCompactNumber(size)} bytes)`;
        if (ctx.vision === false) {
          return { content: `${content}; image input is disabled for the current model` };
        }
        return { content, images: [{ mimeType, data: (await handle.readFile()).toString("base64") }] };
      }
      const page = await readPage(handle, offset, limit);
      if (page.text === null) {
        return { content: `(offset ${offset} is past end of file; file has ${page.totalLines} lines)` };
      }
      const lines = page.text.split(/\r?\n/);
      const lineNumberWidth = String(offset + lines.length - 1).length;
      let out = lines
        .map((line, i) => `${String(offset + i).padStart(lineNumberWidth, " ")}\t${line}`)
        .join("\n");
      if (!page.eof) {
        out += `\n(more lines; use offset=${offset + limit} to continue)`;
      }
      return { content: out };
    } finally {
      await handle.close();
    }
  },
  summarizeResult(result) {
    if (result.images?.length) return summarizeText(result.content, MAX_SUMMARY_LENGTH);
    return summaryBytes("Read", result, "Read failed");
  },
  argSummaryKeys: ["path"],
};
