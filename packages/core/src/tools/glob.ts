import { formatRipgrepOutput, ripgrepResultSummary, runRipgrepLines } from "../util/ripgrep.js";
import { DEFAULT_GLOB_LIMIT, NO_MATCHES } from "../util/constants.js";
import { resolveSearchPath } from "../util/file.js";
import type { Tool } from "./types.js";

const DESCRIPTION = `List files under a directory, optionally filtered by a glob pattern (e.g. **/*.ts). Sorted by modification time (newest first), capped at ${DEFAULT_GLOB_LIMIT}. Skips node_modules and .git, and does not list files excluded by .gitignore.`;

export const globTool: Tool = {
  name: "Glob",
  agentLevel: 1,
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "glob pattern; omit to list all files" },
      path: { type: "string", description: "root directory, defaults to cwd" },
    },
    required: [],
  },
  async execute(args, ctx) {
    const { cwd, target } = resolveSearchPath(args, ctx.cwd);
    const rgArgs = ["--files", "--sortr=modified"];
    const pattern = args.pattern as string;
    if (pattern) rgArgs.push("-g", pattern);
    rgArgs.push(target);
    const { lines, truncated } = await runRipgrepLines(rgArgs, cwd, ctx.signal, DEFAULT_GLOB_LIMIT);
    return { content: formatRipgrepOutput(lines, truncated, NO_MATCHES) };
  },
  summarizeResult(result) {
    return ripgrepResultSummary("file", result, "Glob failed", "Found 0 files");
  },
  argSummaryKeys: ["pattern", "path"],
};
