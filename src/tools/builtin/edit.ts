import { readFileSync, writeFileSync } from "node:fs";
import type { Tool } from "../types.js";

export const edit: Tool = {
  name: "edit",
  description:
    "Replace old_string with new_string in a file. old_string must appear exactly once.",
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
    const content = readFileSync(path, "utf-8");
    const count = content.split(oldStr).length - 1;
    if (count === 0) return `Error: old_string not found in ${path}`;
    if (count > 1)
      return `Error: old_string appears ${count} times in ${path}, must be unique`;
    writeFileSync(path, content.replace(oldStr, newStr), "utf-8");
    return `Edited ${path}`;
  },
};
