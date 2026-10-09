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

const SNIPPET_CONTEXT_LINES = 3;

function renderSnippet(updated: string, at: number, replacement: string): string {
  const lines = updated.split(/\r?\n/);
  const start = Math.max(0, updated.slice(0, at).split(/\r?\n/).length - 1 - SNIPPET_CONTEXT_LINES);
  const end = Math.min(lines.length - 1, updated.slice(0, at + replacement.length).split(/\r?\n/).length - 1 + SNIPPET_CONTEXT_LINES);
  const width = String(end + 1).length;
  const shown: string[] = [];
  for (let i = start; i <= end; i++) {
    shown.push(`${String(i + 1).padStart(width, " ")}\t${lines[i]}`);
  }
  return shown.join("\n");
}

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
    let target = oldStr;
    let replacement = newStr;
    if (!content.includes(target) && content.includes("\r\n")) {
      target = oldStr.replace(/\r?\n/g, "\r\n");
      replacement = newStr.replace(/\r?\n/g, "\r\n");
    }
    if (!content.includes(target)) throw new Error(`old_string not found in ${path}; re-read the file with Read to get the exact current text (watch whitespace/indentation)`);
    if (!all) {
      const count = content.split(target).length - 1;
      if (count > 1) throw new Error(`old_string appears ${count} times in ${path}, must be unique (or set replace_all)`);
    }
    const at = content.indexOf(target);
    const updated = all ? content.split(target).join(replacement) : content.slice(0, at) + replacement + content.slice(at + target.length);
    await writeFile(resolved, updated, "utf-8");
    const notice = `Edited ${path}${all ? " (replaced all)" : ""}. Changed region (cat -n format):`;
    return { content: `${notice}\n${renderSnippet(updated, at, replacement)}\n(no need to Read it back — the region above is current)` };
  },
  summarizeResult(result) {
    if (result.isError) return "Edit failed";
    return "Edit completed";
  },
  argSummaryKeys: ["path"],
};
