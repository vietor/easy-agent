import { readFileSync, writeFileSync } from "node:fs";
import type { Tool } from "../types.js";

const DESCRIPTION = [
  "Replace the single occurrence of old_string with new_string in a file.",
  "old_string must match exactly (including whitespace and indentation) and appear exactly once; read the file first and include enough surrounding context to be unique.",
  "For full rewrites prefer FileWrite.",
].join(" ");

export const fileEditTool: Tool = {
  name: "FileEdit",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(args) {
    const path = args.path as string;
    const oldStr = args.old_string as string;
    const newStr = args.new_string as string;
    if (!path) throw new Error("path is required");
    if (!oldStr) throw new Error("old_string is required");
    if (newStr === undefined) throw new Error("new_string is required");
    const content = readFileSync(path, "utf-8");
    const count = content.split(oldStr).length - 1;
    if (count === 0) throw new Error(`old_string not found in ${path}`);
    if (count > 1) throw new Error(`old_string appears ${count} times in ${path}, must be unique`);
    writeFileSync(path, content.replace(oldStr, newStr), "utf-8");
    return `Edited ${path}`;
  },
  summarize(args) {
    return (args.path as string) ?? "";
  },
};
