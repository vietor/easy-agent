import { resolveCwd, runRgLines } from "../util/ripgrep.js";
import type { Tool } from "./types.js";

const DEFAULT_HEAD_LIMIT = 200;

const DESCRIPTION = [
  "Search file contents under a directory recursively for a regex pattern (RE2 syntax).",
  "Includes hidden files (e.g. .env, .gitignore); skips node_modules and .git.",
  "By default returns matching lines as path:line:content, capped at 200 lines; use output_mode, head_limit, and context options to control output.",
].join(" ");

export const grepTool: Tool = {
  name: "Grep",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "root directory, defaults to cwd" },
      glob: { type: "string", description: "glob pattern to filter files (e.g. *.ts)" },
      type: { type: "string", description: "file type to search (e.g. ts, js, py, rust, go)" },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description: "content (default, matching lines), files_with_matches (file paths only), count (match counts per file)",
      },
      ignore_case: { type: "boolean", description: "case-insensitive match" },
      before: { type: "number", description: "lines to show before each match" },
      after: { type: "number", description: "lines to show after each match" },
      context: { type: "number", description: "lines to show before and after each match" },
      only_matching: { type: "boolean", description: "print only the matched (non-empty) parts" },
      multiline: { type: "boolean", description: "allow patterns to span newlines" },
      head_limit: { type: "number", description: "max output lines (default 200)" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const cwd = resolveCwd(args.path as string | undefined, ctx.cwd);
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
    const output_mode = (args.output_mode as string) || "content";
    if (output_mode === "files_with_matches") rgArgs.push("-l");
    else if (output_mode === "count") rgArgs.push("-c");
    rgArgs.push(args.pattern as string, ".");
    const lines = await runRgLines(rgArgs, cwd, ctx.signal);
    if (!lines.length) return "(no matches)";
    const headLimit = (args.head_limit as number) || DEFAULT_HEAD_LIMIT;
    if (lines.length > headLimit) {
      return lines.slice(0, headLimit).join("\n") + `\n(${lines.length - headLimit} more matches, truncated)`;
    }
    return lines.join("\n");
  },
  summaryArg: ["pattern", "path"],
};
