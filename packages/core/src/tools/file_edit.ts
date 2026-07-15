import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./types.js";

const DESCRIPTION = [
  "Replace occurrences of old_string with new_string in a file.",
  "Always read the file (FileRead) before editing — old_string must match the exact current content including whitespace and indentation; include enough surrounding context to be unique.",
  "Make minimal, surgical changes that match the surrounding code style.",
  "By default old_string must appear exactly once; set replace_all to true to replace every occurrence.",
  "When copying old_string from FileRead output, strip the leading line-number prefix (digits and tab) before matching.",
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
      replace_all: { type: "boolean", description: "replace all occurrences (default false)" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(args) {
    const path = args.path as string;
    const oldStr = args.old_string as string;
    const newStr = args.new_string as string;
    const all = args.replace_all === true;
    if (!path) throw new Error("path is required");
    if (!oldStr) throw new Error("old_string is required");
    const content = await readFile(path, "utf-8");
    if (!content.includes(oldStr)) throw new Error(`old_string not found in ${path}`);
    if (all) {
      await writeFile(path, content.split(oldStr).join(newStr), "utf-8");
      return `Edited ${path} (replaced all)`;
    }
    const count = content.split(oldStr).length - 1;
    if (count > 1) throw new Error(`old_string appears ${count} times in ${path}, must be unique (or set replace_all)`);
    await writeFile(path, content.replace(oldStr, newStr), "utf-8");
    return `Edited ${path}`;
  },
  summaryArg: "path",
};
