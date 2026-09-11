import { z } from "zod";
import { formatRipgrepOutput, ripgrepResultSummary, runRipgrepLines } from "../util/ripgrep.js";
import { DEFAULT_GREP_LIMIT, NO_MATCHES } from "../util/constants.js";
import { resolveSearchPath } from "../util/file.js";
import type { Tool } from "./types.js";
import { parseToolArgs, toToolParameters } from "./types.js";

const DESCRIPTION = `Search file contents recursively for a regex pattern (RE2 syntax). Skips node_modules and .git, and does not search files excluded by .gitignore. Content mode returns path:line:content sorted by file path, capped at ${DEFAULT_GREP_LIMIT} lines. For large codebases, use output_mode=files_with_matches first, or narrow with glob/type, or raise head_limit. Use offset to page through more results in the same order (content mode only).`;

const HEAD_LIMIT_ERROR = "head_limit must be a positive integer";

function nonNegative(name: string, description: string) {
  const error = `${name} must be a non-negative integer`;
  return z.number({ error }).min(0, { error }).refine(Number.isInteger, { error }).describe(description);
}

const GrepArgs = z.object({
  pattern: z.string({ error: "pattern is required" }).min(1, { error: "pattern is required" }),
  path: z.string({ error: "path must be a string" }).optional().describe("file or directory, defaults to cwd"),
  glob: z.string({ error: "glob must be a string" }).optional().describe("filter files, e.g. *.ts"),
  type: z.string({ error: "type must be a string" }).optional().describe("file type, e.g. ts, js, py"),
  output_mode: z.enum(["content", "files_with_matches", "count"], { error: "output_mode must be content, files_with_matches, or count" })
    .default("content")
    .describe("defaults to content"),
  ignore_case: z.boolean({ error: "ignore_case must be a boolean" }).optional().describe("case-insensitive"),
  before: nonNegative("before", "lines before each match").optional(),
  after: nonNegative("after", "lines after each match").optional(),
  context: nonNegative("context", "lines before and after each match").optional(),
  only_matching: z.boolean({ error: "only_matching must be a boolean" }).optional().describe("only the matched parts"),
  multiline: z.boolean({ error: "multiline must be a boolean" }).optional().describe("patterns may span newlines"),
  head_limit: z.number({ error: HEAD_LIMIT_ERROR }).min(1, { error: HEAD_LIMIT_ERROR })
    .refine(Number.isInteger, { error: HEAD_LIMIT_ERROR })
    .default(DEFAULT_GREP_LIMIT)
    .describe(`max output lines, default ${DEFAULT_GREP_LIMIT}`),
  offset: nonNegative("offset", "skip this many result lines before returning results (content mode only)").default(0),
});

export const grepTool: Tool = {
  name: "Grep",
  agentLevel: 1,
  description: DESCRIPTION,
  parameters: toToolParameters(GrepArgs),
  async execute(args, ctx) {
    const { pattern, path, glob, type, output_mode, ignore_case, before, after, context, only_matching, multiline, head_limit, offset } = parseToolArgs(GrepArgs, args);
    const { cwd, target } = resolveSearchPath(path, ctx.cwd);
    if (output_mode !== "content" && offset > 0) {
      throw new Error("offset is only supported with output_mode=content");
    }
    const rgArgs = ["--line-number", "--with-filename", "--no-heading"];
    if (ignore_case) rgArgs.push("-i");
    if (only_matching) rgArgs.push("-o");
    if (multiline) rgArgs.push("-U", "--multiline-dotall");
    if (context) rgArgs.push("-C", String(context));
    else {
      if (before) rgArgs.push("-B", String(before));
      if (after) rgArgs.push("-A", String(after));
    }
    if (glob) rgArgs.push("-g", glob);
    if (type) rgArgs.push("-t", type);
    if (output_mode === "files_with_matches") rgArgs.push("-l");
    else if (output_mode === "count") rgArgs.push("-c");
    else rgArgs.push("--sort=path", "-m", String(offset + head_limit));
    rgArgs.push("--", pattern, target);
    const { lines, truncated } = await runRipgrepLines(rgArgs, cwd, ctx.signal, head_limit, offset);
    if (offset > 0 && lines.length === 0) {
      return { content: `(no entries at offset ${offset} — end of results)` };
    }
    return { content: formatRipgrepOutput(lines, truncated, NO_MATCHES) };
  },
  summarizeResult(result) {
    return ripgrepResultSummary("match", result, "Grep failed", "Found 0 matches");
  },
  argSummaryKeys: ["pattern", "path", "glob"],
};
