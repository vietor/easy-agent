import { z } from "zod";
import { directoryBreakdown, renderListing, ripgrepResultSummary, runRipgrepLines } from "../util/ripgrep.js";
import { DEFAULT_GREP_LIMIT } from "../util/constants.js";
import { resolveSearchPath } from "../util/file.js";
import type { Tool } from "./types.js";
import { nonNegativeInt, parseToolArgs, toToolParameters } from "./types.js";

const DESCRIPTION = `Search file contents recursively for a regex pattern (RE2 syntax). Skips node_modules and .git, and does not search files excluded by .gitignore. Content mode returns path:line:content sorted by file path, capped at ${DEFAULT_GREP_LIMIT} lines. For large codebases, use output_mode=files_with_matches first, or narrow with glob/type, or raise head_limit. Use offset to page through more results in the same order.`;

const GrepArgs = z.object({
  pattern: z.string({ error: "pattern is required" }).min(1, { error: "pattern is required" }),
  path: z.string({ error: "path must be a string" }).optional().describe("file or directory, defaults to cwd"),
  glob: z.string({ error: "glob must be a string" }).optional().describe("filter files, e.g. *.ts"),
  type: z.string({ error: "type must be a string" }).optional().describe("file type, e.g. ts, js, py"),
  output_mode: z.enum(["content", "files_with_matches", "count"], { error: "output_mode must be content, files_with_matches, or count" })
    .default("content")
    .describe("defaults to content"),
  ignore_case: z.boolean({ error: "ignore_case must be a boolean" }).optional().describe("case-insensitive"),
  before: nonNegativeInt("before", "lines before each match").optional(),
  after: nonNegativeInt("after", "lines after each match").optional(),
  context: nonNegativeInt("context", "lines before and after each match").optional(),
  only_matching: z.boolean({ error: "only_matching must be a boolean" }).optional().describe("only the matched parts"),
  multiline: z.boolean({ error: "multiline must be a boolean" }).optional().describe("patterns may span newlines"),
  head_limit: nonNegativeInt("head_limit", `max output lines, pass 0 for unlimited, default ${DEFAULT_GREP_LIMIT}`).default(DEFAULT_GREP_LIMIT),
  offset: nonNegativeInt("offset", "skip this many result lines before returning results").default(0),
});

export const grepTool: Tool = {
  name: "Grep",
  agentLevel: 1,
  concurrencySafe: true,
  description: DESCRIPTION,
  parameters: toToolParameters(GrepArgs),
  async execute(args, ctx) {
    const { pattern, path, glob, type, output_mode, ignore_case, before, after, context, only_matching, multiline, head_limit, offset } = parseToolArgs(GrepArgs, args);
    const { cwd, target } = resolveSearchPath(path, ctx.cwd);
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
    rgArgs.push("--sort=path");
    if (output_mode === "files_with_matches") rgArgs.push("-l");
    else if (output_mode === "count") rgArgs.push("-c");
    else if (head_limit) rgArgs.push("-m", String(offset + head_limit));
    rgArgs.push("--", pattern, target);
    const result = await runRipgrepLines(rgArgs, cwd, ctx.signal, head_limit || undefined, offset);
    const censusPaths = output_mode === "count" ? result.all.map((line) => line.replace(/:\d+$/, "")) : result.all;
    const census = output_mode === "content" ? undefined : directoryBreakdown(censusPaths);
    const noun = output_mode === "content" ? "match" : "file";
    return { content: renderListing(result, noun, census, offset) };
  },
  summarizeResult(result) {
    return ripgrepResultSummary("match", result, "Grep failed");
  },
  argSummaryKeys: ["pattern", "path", "glob"],
};
