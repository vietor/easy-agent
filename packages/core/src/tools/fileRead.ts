import { open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool } from "./types.js";
import { compactFormat, getTextBytes } from "../util/text.js";

const DEFAULT_LIMIT = 2000;
const MAX_FILE_BYTES = 20_000_000;
const CHUNK = 64 * 1024;

const DESCRIPTION = "Read a file as UTF-8 text, returned with line numbers (cat -n format). Reads up to 2000 lines; use offset and limit to page further. Files over 20MB are rejected. Binary files may return garbled output or fail.";

interface PageRead {
  /** null when offset is past the end of the file */
  text: string | null;
  /** exact line count; only meaningful when text !== null && eof */
  totalLines: number;
  /** whether the read reached EOF, so no more lines follow the page */
  eof: boolean;
}

/** Read up to `limit` lines starting at 1-based `offset`, without loading the whole file. */
async function readPage(handle: FileHandle, offset: number, limit: number): Promise<PageRead> {
  const startLine = offset - 1; // 0-based line the page begins at
  let newlines = 0;
  let winStart = startLine === 0 ? 0 : -1; // byte index in the current chunk where the page begins
  const pieces: Buffer[] = [];
  const buf = Buffer.allocUnsafe(CHUNK);
  for (;;) {
    const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
    if (bytesRead === 0) break;
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] !== 0x0a) continue;
      // a newline with pre-increment count c ends line c; the page starts after
      // the newline ending line startLine-1 and ends at the newline ending line startLine+limit-1
      if (newlines === startLine - 1) winStart = i + 1;
      newlines++;
      if (newlines === startLine + limit) {
        if (winStart >= 0 && winStart < i) pieces.push(Buffer.from(buf.subarray(winStart, i)));
        return { text: Buffer.concat(pieces).toString("utf-8"), totalLines: -1, eof: false };
      }
    }
    if (winStart >= 0) {
      if (winStart < bytesRead) pieces.push(Buffer.from(buf.subarray(winStart, bytesRead)));
      winStart = 0;
    }
  }
  const totalLines = newlines + 1;
  if (startLine >= totalLines) return { text: null, totalLines, eof: true };
  return { text: Buffer.concat(pieces).toString("utf-8"), totalLines, eof: true };
}

export const fileReadTool: Tool = {
  name: "FileRead",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "number", description: "line number to start reading from (1-indexed)" },
      limit: { type: "number", description: "number of lines to read (default 2000)" },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const path = resolve(ctx.cwd, args.path as string);
    const offset = (args.offset as number) || 1;
    const limit = (args.limit as number) || DEFAULT_LIMIT;
    const handle = await open(path, "r");
    try {
      const { size } = await handle.stat();
      if (size > MAX_FILE_BYTES) {
        throw new Error(`file is ${compactFormat(size)} — larger than the ${compactFormat(MAX_FILE_BYTES)} read limit`);
      }
      if (size === 0) return "(empty file)";
      const { text, totalLines, eof } = await readPage(handle, offset, limit);
      if (text === null) {
        return `(offset ${offset} is past end of file; file has ${totalLines} lines)`;
      }
      const lines = text.split("\n");
      let out = lines
        .map((line, i) => `${String(offset + i).padStart(6, " ")}\t${line}`)
        .join("\n");
      if (!eof) {
        out += `\n(more lines; use offset=${offset + limit} to continue)`;
      }
      return out;
    } finally {
      await handle.close();
    }
  },
  getPreview(result) {
    if (result.isError) return "Read failed";
    const bytes = getTextBytes(result.content);
    return `Read ${compactFormat(bytes)} bytes`;
  },
  summaryArg: "path",
};
