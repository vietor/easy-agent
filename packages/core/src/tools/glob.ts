import { resolveCwd, runRgLines } from "../util/ripgrep.js";
import { NO_MATCHES } from "../util/constants.js";
import { previewCount, TRUNCATION_MARKER, visibleLineCount } from "../util/text.js";
import type { Tool } from "./types.js";

const DESCRIPTION = "List files under a directory, optionally filtered by a glob pattern (e.g. **/*.ts). Skips node_modules and .git.";

export const globTool: Tool = {
  name: "Glob",
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
    const cwd = resolveCwd(args.path as string | "", ctx.cwd);
    const rgArgs = ["--files"];
    const pattern = args.pattern as string;
    if (pattern) rgArgs.push("-g", pattern);
    rgArgs.push(".");
    const { lines, truncated } = await runRgLines(rgArgs, cwd, ctx.signal);
    if (!lines.length) return NO_MATCHES;
    const out = lines.join("\n");
    return truncated ? out + "\n" + TRUNCATION_MARKER : out;
  },
  getPreview(result) {
    if (result.content === NO_MATCHES) return "Found 0 files";
    return previewCount("file", visibleLineCount(result.content), !!result.isError, "Glob failed");
  },
  summaryArg: ["pattern", "path"],
};
