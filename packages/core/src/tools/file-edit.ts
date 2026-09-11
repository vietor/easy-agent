import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";
import { parseToolArgs, toToolParameters } from "./types.js";

const DESCRIPTION = "Replace old_string with new_string in a file. Read the file first — old_string must match exactly including whitespace/indentation. Must be unique unless replace_all is set. For full rewrites prefer Write.";

const PATH_ERROR = "path is required";
const OLD_STRING_ERROR = "old_string is required";
const NEW_STRING_ERROR = "new_string is required";
const REPLACE_ALL_ERROR = "replace_all must be a boolean";

const EditArgs = z.object({
  path: z.string({ error: PATH_ERROR }).min(1, { error: PATH_ERROR }),
  old_string: z.string({ error: OLD_STRING_ERROR }).min(1, { error: OLD_STRING_ERROR }),
  new_string: z.string({ error: NEW_STRING_ERROR }),
  replace_all: z.boolean({ error: REPLACE_ALL_ERROR }).optional().describe("replace all occurrences (default false)"),
});

export const fileEditTool: Tool = {
  name: "Edit",
  agentLevel: 2,
  description: DESCRIPTION,
  parameters: toToolParameters(EditArgs),
  async execute(args, ctx) {
    const { path, old_string: oldStr, new_string: newStr, replace_all } = parseToolArgs(EditArgs, args);
    const resolved = resolve(ctx.cwd, path);
    const all = replace_all === true;
    const content = await readFile(resolved, "utf-8");
    if (!content.includes(oldStr)) throw new Error(`old_string not found in ${path}; re-read the file with Read to get the exact current text (watch whitespace/indentation)`);
    if (all) {
      await writeFile(resolved, content.split(oldStr).join(newStr), "utf-8");
      return { content: `Edited ${path} (replaced all)` };
    }
    const count = content.split(oldStr).length - 1;
    if (count > 1) throw new Error(`old_string appears ${count} times in ${path}, must be unique (or set replace_all)`);
    await writeFile(resolved, content.replace(oldStr, newStr), "utf-8");
    return { content: `Edited ${path}` };
  },
  summarizeResult(result) {
    if (result.isError) return "Edit failed";
    return "Edit completed";
  },
  argSummaryKeys: ["path"],
};
