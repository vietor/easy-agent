import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "./types.js";

const DESCRIPTION = [
  "Write content to a file, overwriting it entirely if it exists and creating parent directories as needed.",
  "Use for new files or full rewrites; for targeted changes prefer FileEdit.",
].join(" ");

export const fileWriteTool: Tool = {
  name: "FileWrite",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(args) {
    const path = args.path as string;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, args.content as string, "utf-8");
    return `Wrote ${path}`;
  },
  summaryArg: "path",
};
