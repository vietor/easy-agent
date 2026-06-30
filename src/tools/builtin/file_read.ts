import { readFile } from "node:fs/promises";
import type { Tool } from "../types.js";

const DESCRIPTION = [
  "Read a file's full contents as UTF-8 text.",
  "path may be relative (to the working directory) or absolute.",
].join(" ");

export const fileReadTool: Tool = {
  name: "FileRead",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(args) {
    return readFile(args.path as string, "utf-8");
  },
  summaryArg: "path",
};
