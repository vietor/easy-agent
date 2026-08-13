import { formatRgOutput, rgResultSummary, runRgLines } from "../util/ripgrep.js";
import { NO_MATCHES } from "../util/constants.js";
import { resolveOptionalPath } from "../util/file.js";
import type { Tool } from "./types.js";

const DESCRIPTION = "List files under a directory, optionally filtered by a glob pattern (e.g. **/*.ts). Skips node_modules and .git.";

export const globTool: Tool = {
  name: "Glob",
  readOnly: true,
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
    const cwd = resolveOptionalPath(args, ctx.cwd);
    const rgArgs = ["--files"];
    const pattern = args.pattern as string;
    if (pattern) rgArgs.push("-g", pattern);
    rgArgs.push(".");
    const { lines, truncated } = await runRgLines(rgArgs, cwd, ctx.signal);
    return { content: formatRgOutput(lines, truncated, NO_MATCHES) };
  },
  summarizeResult(result) {
    return rgResultSummary("file", result, "Glob failed", "Found 0 files");
  },
  summaryKeys: ["pattern", "path"],
};
