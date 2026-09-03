import { open, type FileHandle } from "node:fs/promises";
import type { Tool } from "./types.js";
import { resolveRequiredPath } from "../util/file.js";
import { DEFAULT_FILE_READ_LIMIT, MAX_FILE_READ_MB, mbToBytes } from "../util/constants.js";
import { formatCompactNumber, summaryBytes } from "../util/text.js";

const CHUNK = 64 * 1024;
const MAX_FILE_READ_BYTES = mbToBytes(MAX_FILE_READ_MB);

const DESCRIPTION = `Read a file as UTF-8 text, returned with line numbers (cat -n format). Reads up to ${DEFAULT_FILE_READ_LIMIT} lines; use offset and limit to page further. Files over ${MAX_FILE_READ_MB}MB are rejected. Binary files may return garbled output or fail.`;

interface PageRead {
  text: string | null;
  totalLines: number;
  eof: boolean;
}

async function readPage(handle: FileHandle, offset: number, limit: number): Promise<PageRead> {
  const startLine = offset - 1;
  let newlines = 0;
  let windowStart = startLine === 0 ? 0 : -1;
  const pieces: Buffer[] = [];
  const buf = Buffer.allocUnsafe(CHUNK);
  for (;;) {
    const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
    if (bytesRead === 0) break;
    for (let from = 0; ; ) {
      const i = buf.indexOf(0x0a, from);
      if (i === -1 || i >= bytesRead) break;
      if (newlines === startLine - 1) windowStart = i + 1;
      newlines++;
      if (newlines === startLine + limit) {
        if (windowStart >= 0 && windowStart < i) pieces.push(Buffer.from(buf.subarray(windowStart, i)));
        return { text: Buffer.concat(pieces).toString("utf-8"), totalLines: -1, eof: false };
      }
      from = i + 1;
    }
    if (windowStart >= 0) {
      if (windowStart < bytesRead) pieces.push(Buffer.from(buf.subarray(windowStart, bytesRead)));
      windowStart = 0;
    }
  }
  const totalLines = newlines + 1;
  if (startLine >= totalLines) return { text: null, totalLines, eof: true };
  return { text: Buffer.concat(pieces).toString("utf-8"), totalLines, eof: true };
}

export const fileReadTool: Tool = {
  name: "Read",
  readOnly: true,
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "number", description: "line number to start reading from (1-indexed)" },
      limit: { type: "number", description: `number of lines to read (default ${DEFAULT_FILE_READ_LIMIT})` },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const resolved = resolveRequiredPath(args, ctx.cwd);
    const offset = args.offset === undefined ? 1 : args.offset;
    const limit = args.limit === undefined ? DEFAULT_FILE_READ_LIMIT : args.limit;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 1) throw new Error("offset must be a positive integer");
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
    const handle = await open(resolved, "r");
    try {
      const { size } = await handle.stat();
      if (size > MAX_FILE_READ_BYTES) {
        throw new Error(`file is ${formatCompactNumber(size)} — larger than the ${formatCompactNumber(MAX_FILE_READ_BYTES)} read limit`);
      }
      if (size === 0) return { content: "(empty file)" };
      const { text, totalLines, eof } = await readPage(handle, offset, limit);
      if (text === null) {
        return { content: `(offset ${offset} is past end of file; file has ${totalLines} lines)` };
      }
      const lines = text.split("\n");
      let out = lines
        .map((line, i) => `${String(offset + i).padStart(6, " ")}\t${line}`)
        .join("\n");
      if (!eof) {
        out += `\n(more lines; use offset=${offset + limit} to continue)`;
      }
      return { content: out };
    } finally {
      await handle.close();
    }
  },
  summarizeResult(result) {
    return summaryBytes("Read", result, "Read failed");
  },
  argSummaryKeys: ["path"],
};
