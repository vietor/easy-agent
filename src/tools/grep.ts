import { resolveCwd, runRgLines } from "../util/ripgrep.js";
import type { Tool } from "./types.js";

const MAX_MATCHES = 200;

const DESCRIPTION = [
  "Search file contents under a directory recursively for a regex pattern (RE2 syntax).",
  "Includes hidden files (e.g. .env, .gitignore); skips node_modules and .git.",
  "Returns matching lines as path:line:content, capped at 200 matches.",
].join(" ");

export const grepTool: Tool = {
  name: "Grep",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "root directory, defaults to cwd" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const cwd = resolveCwd(args.path as string | undefined);
    const rgArgs = [
      "--line-number",
      "--with-filename",
      "--no-heading",
      args.pattern as string,
      ".",
    ];
    const lines = await runRgLines(rgArgs, cwd, ctx.signal);
    if (!lines.length) return "(no matches)";
    if (lines.length > MAX_MATCHES) return lines.slice(0, MAX_MATCHES).join("\n") + "\n(truncated)";
    return lines.join("\n");
  },
  summaryArg: ["pattern", "path"],
};
