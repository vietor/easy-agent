import { resolveCwd, runRgLines } from "../util/ripgrep.js";
import type { Tool } from "./types.js";

const DESCRIPTION = [
  "List files under a directory, optionally filtered by a glob pattern (e.g. **/*.ts); omit pattern to list every file.",
  "Skips node_modules and .git.",
  "Returns paths relative to the root, one per line.",
].join(" ");

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
  async execute(args) {
    const cwd = resolveCwd(args.path as string | undefined);
    const rgArgs = ["--files"];
    const pattern = args.pattern as string;
    if (pattern) rgArgs.push("-g", pattern);
    rgArgs.push(".");
    const files = await runRgLines(rgArgs, cwd);
    return files.length ? files.join("\n") : "(no matches)";
  },
  summaryArg: ["pattern", "path"],
};
