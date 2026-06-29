import { isAbsolute, join } from "node:path";
import { runRg } from "../../util/ripgrep.js";
import type { Tool } from "../types.js";

const MAX_MATCHES = 200;

const DESCRIPTION = [
  "Search file contents under a directory recursively for a regex pattern (RE2 syntax).",
  "Skips node_modules and .git.",
  "Returns matching lines as path:line: content, capped at 200 matches.",
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
  async execute(args) {
    const root = (args.path as string) || ".";
    const cwd = isAbsolute(root) ? root : join(process.cwd(), root);
    const rgArgs = [
      "--line-number",
      "--with-filename",
      "--no-heading",
      "--path-separator",
      "/",
      args.pattern as string,
      ".",
    ];
    const lines = runRg(rgArgs, cwd)
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^\.\//, ""));
    if (!lines.length) return "(no matches)";
    if (lines.length > MAX_MATCHES) return lines.slice(0, MAX_MATCHES).join("\n") + "\n(truncated)";
    return lines.join("\n");
  },
  summarize(args) {
    return (args.path ?? args.pattern ?? "") as string;
  },
};
