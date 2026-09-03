import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./types.js";
import { resolveRequiredPath } from "../util/file.js";

const DESCRIPTION = "Replace old_string with new_string in a file. Read the file first — old_string must match exactly including whitespace/indentation. Must be unique unless replace_all is set. For full rewrites prefer Write.";

export const fileEditTool: Tool = {
  name: "Edit",
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
    const resolved = resolveRequiredPath(args, ctx.cwd);
    const oldStr = args.old_string as string;
    const newStr = args.new_string as string;
    const all = args.replace_all === true;
    if (!oldStr) throw new Error("old_string is required");
    const content = await readFile(resolved, "utf-8");
    if (!content.includes(oldStr)) throw new Error(`old_string not found in ${args.path}; re-read the file with Read to get the exact current text (watch whitespace/indentation)`);
    if (all) {
      await writeFile(resolved, content.split(oldStr).join(newStr), "utf-8");
      return { content: `Edited ${args.path} (replaced all)` };
    }
    const count = content.split(oldStr).length - 1;
    if (count > 1) throw new Error(`old_string appears ${count} times in ${args.path}, must be unique (or set replace_all)`);
    await writeFile(resolved, content.replace(oldStr, newStr), "utf-8");
    return { content: `Edited ${args.path}` };
  },
  summarizeResult(result) {
    if (result.isError) return "Edit failed";
    return "Edit completed";
  },
  argSummaryKeys: ["path"],
};
