import { readFileSync } from "node:fs";
import type { Tool } from "../types.js";

export const fileReadTool: Tool = {
  name: "FileRead",
  description: "Read a file's full contents as UTF-8 text. path may be relative (to the working directory) or absolute.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(args) {
    return readFileSync(args.path as string, "utf-8");
  },
  summarize(args) {
    return (args.path as string) ?? "";
  },
};
