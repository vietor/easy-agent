import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool } from "./types.js";

const DESCRIPTION = "Replace old_string with new_string in a file. Read the file first — old_string must match exactly including whitespace/indentation. Must be unique unless replace_all is set. For full rewrites prefer FileWrite.";

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
  async execute(args, ctx) {
    const path = args.path as string;
    const resolved = resolve(ctx.cwd, path);
    const oldStr = args.old_string as string;
    const newStr = args.new_string as string;
    const all = args.replace_all === true;
    if (!path) throw new Error("path is required");
    if (!oldStr) throw new Error("old_string is required");
    const content = await readFile(resolved, "utf-8");
    if (!content.includes(oldStr)) throw new Error(`old_string not found in ${path}`);
    if (all) {
      await writeFile(resolved, content.split(oldStr).join(newStr), "utf-8");
      return `Edited ${path} (replaced all)`;
    }
    const count = content.split(oldStr).length - 1;
    if (count > 1) throw new Error(`old_string appears ${count} times in ${path}, must be unique (or set replace_all)`);
    await writeFile(resolved, content.replace(oldStr, newStr), "utf-8");
    return `Edited ${path}`;
  },
  summaryArg: "path",
};
