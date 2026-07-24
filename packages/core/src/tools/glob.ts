import { resolveCwd, runRgLines } from "../util/ripgrep.js";
import type { Tool } from "./types.js";

const NO_MATCHES = "(no matches)";

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
    const files = await runRgLines(rgArgs, cwd, ctx.signal);
    return files.length ? files.join("\n") : NO_MATCHES;
  },
  getPreview(result) {
    if (result.isError) return "Glob failed";
    if (result.content === NO_MATCHES) return "Found 0 files";
    const count = result.content.split("\n").filter((l) => l).length;
    return `Found ${count} file${count !== 1 ? "s" : ""}`;
  },
  summaryArg: ["pattern", "path"],
};
