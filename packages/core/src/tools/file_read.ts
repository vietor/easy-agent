import { readFile } from "node:fs/promises";
import type { Tool } from "./types.js";

const DEFAULT_LIMIT = 2000;

const DESCRIPTION = [
  "Read a file's contents as UTF-8 text, returned with line numbers (cat -n format).",
  "path may be relative (to the working directory) or absolute.",
  "Reads up to 2000 lines by default; use offset and limit to page through larger files.",
].join(" ");

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
  async execute(args) {
    const path = args.path as string;
    const offset = (args.offset as number) || 1;
    const limit = (args.limit as number) || DEFAULT_LIMIT;
    const content = await readFile(path, "utf-8");
    if (!content) return "(empty file)";
    const lines = content.split("\n");
    const start = Math.max(0, offset - 1);
    if (start >= lines.length) {
      return `(offset ${offset} is past end of file; file has ${lines.length} lines)`;
    }
    const end = Math.min(lines.length, start + limit);
    const slice = lines.slice(start, end);
    let out = slice
      .map((line, i) => `${String(start + i + 1).padStart(6, " ")}\t${line}`)
      .join("\n");
    if (end < lines.length) {
      out += `\n(${lines.length - end} more lines; use offset=${end + 1} to continue)`;
    }
    return out;
  },
  summaryArg: "path",
};
