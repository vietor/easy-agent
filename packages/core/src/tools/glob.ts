import { z } from "zod";
import { formatRipgrepOutput, ripgrepResultSummary, runRipgrepLines } from "../util/ripgrep.js";
import { DEFAULT_GLOB_LIMIT, NO_MATCHES } from "../util/constants.js";
import { resolveSearchPath } from "../util/file.js";
import type { Tool } from "./types.js";
import { parseToolArgs, toToolParameters } from "./types.js";

const DESCRIPTION = `List files under a directory, optionally filtered by a glob pattern (e.g. **/*.ts). Sorted by modification time (newest first), capped at ${DEFAULT_GLOB_LIMIT}. Skips node_modules and .git, and does not list files excluded by .gitignore.`;

const GlobArgs = z.object({
  pattern: z.string({ error: "pattern must be a string" }).optional().describe("glob pattern; omit to list all files"),
  path: z.string({ error: "path must be a string" }).optional().describe("root directory, defaults to cwd"),
});

export const globTool: Tool = {
  name: "Glob",
  agentLevel: 1,
  description: DESCRIPTION,
  parameters: toToolParameters(GlobArgs),
  async execute(args, ctx) {
    const { pattern, path } = parseToolArgs(GlobArgs, args);
    const { cwd, target } = resolveSearchPath(path, ctx.cwd);
    const rgArgs = ["--files", "--sortr=modified"];
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
