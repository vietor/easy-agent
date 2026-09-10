import { formatRipgrepOutput, ripgrepResultSummary, runRipgrepLines } from "../util/ripgrep.js";
import { DEFAULT_GREP_LIMIT, NO_MATCHES } from "../util/constants.js";
import { resolveSearchPath } from "../util/file.js";
import type { Tool } from "./types.js";

const DESCRIPTION = `Search file contents recursively for a regex pattern (RE2 syntax). Skips node_modules and .git, and does not search files excluded by .gitignore. Content mode returns path:line:content sorted by file path, capped at ${DEFAULT_GREP_LIMIT} lines. For large codebases, use output_mode=files_with_matches first, or narrow with glob/type, or raise head_limit. Use offset to page through more results in the same order (content mode only).`;

export const grepTool: Tool = {
  name: "Grep",
  agentLevel: 1,
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "file or directory, defaults to cwd" },
      glob: { type: "string", description: "filter files, e.g. *.ts" },
      type: { type: "string", description: "file type, e.g. ts, js, py" },
      output_mode: { type: "string", enum: ["content", "files_with_matches", "count"], description: "defaults to content" },
      ignore_case: { type: "boolean", description: "case-insensitive" },
      before: { type: "number", description: "lines before each match" },
      after: { type: "number", description: "lines after each match" },
      context: { type: "number", description: "lines before and after each match" },
      only_matching: { type: "boolean", description: "only the matched parts" },
      multiline: { type: "boolean", description: "patterns may span newlines" },
      head_limit: { type: "number", description: `max output lines, default ${DEFAULT_GREP_LIMIT}` },
      offset: { type: "number", description: "skip this many result lines before returning results (content mode only)" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const { cwd, target } = resolveSearchPath(args, ctx.cwd);
    const offset = args.offset === undefined ? 0 : args.offset;
    const output_mode = (args.output_mode as string) || "content";
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
      throw new Error("offset must be a non-negative integer");
    }
    if (output_mode !== "content" && offset > 0) {
      throw new Error("offset is only supported with output_mode=content");
    }
    const rgArgs = ["--line-number", "--with-filename", "--no-heading"];
    if (args.ignore_case) rgArgs.push("-i");
    if (args.only_matching) rgArgs.push("-o");
    if (args.multiline) rgArgs.push("-U", "--multiline-dotall");
    const context = args.context as number | undefined;
    if (context) rgArgs.push("-C", String(context));
    else {
      const before = args.before as number | undefined;
      const after = args.after as number | undefined;
      if (before) rgArgs.push("-B", String(before));
      if (after) rgArgs.push("-A", String(after));
    }
    if (args.glob) rgArgs.push("-g", args.glob as string);
    if (args.type) rgArgs.push("-t", args.type as string);
    const headLimit = (args.head_limit as number) || DEFAULT_GREP_LIMIT;
    if (output_mode === "files_with_matches") rgArgs.push("-l");
    else if (output_mode === "count") rgArgs.push("-c");
    else rgArgs.push("--sort=path", "-m", String(offset + headLimit));
    rgArgs.push("--", args.pattern as string, target);
    const { lines, truncated } = await runRipgrepLines(rgArgs, cwd, ctx.signal, headLimit, offset);
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
