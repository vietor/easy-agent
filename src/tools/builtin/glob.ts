import { isAbsolute, join } from "node:path";
import { runRg } from "../../util/ripgrep.js";
import type { Tool } from "../types.js";

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
    const root = (args.path as string) || ".";
    const cwd = isAbsolute(root) ? root : join(process.cwd(), root);
    const rgArgs = ["--files", "--path-separator", "/"];
    const pattern = args.pattern as string;
    if (pattern) rgArgs.push("-g", pattern);
    rgArgs.push(".");
    const files = runRg(rgArgs, cwd)
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replace(/^\.\//, ""));
    return files.length ? files.join("\n") : "(no matches)";
  },
  summarize(args) {
    return (args.path ?? args.pattern ?? "") as string;
  },
};
