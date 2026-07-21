import { resolveCwd, runRgLines } from "../util/ripgrep.js";
import type { Tool } from "./types.js";

const DEFAULT_HEAD_LIMIT = 200;

const DESCRIPTION = "Search file contents recursively for a regex pattern (RE2 syntax). Skips node_modules and .git. Returns path:line:content, capped at 200 lines.";

export const grepTool: Tool = {
  name: "Grep",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "root directory, defaults to cwd" },
      glob: { type: "string", description: "filter files, e.g. *.ts" },
      type: { type: "string", description: "file type, e.g. ts, js, py" },
      output_mode: { type: "string", enum: ["content", "files_with_matches", "count"], description: "defaults to content" },
      ignore_case: { type: "boolean", description: "case-insensitive" },
      before: { type: "number", description: "lines before each match" },
      after: { type: "number", description: "lines after each match" },
      context: { type: "number", description: "lines before and after each match" },
      only_matching: { type: "boolean", description: "only the matched parts" },
      multiline: { type: "boolean", description: "patterns may span newlines" },
      head_limit: { type: "number", description: "max output lines, default 200" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const cwd = resolveCwd(args.path as string | "", ctx.cwd);
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
