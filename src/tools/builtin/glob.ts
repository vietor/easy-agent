import { relative, isAbsolute, join } from "node:path";
import { walkFiles } from "../../util/fs.js";
import type { Tool } from "../types.js";

function toRegex(pattern: string): RegExp {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "<<DS>>")
    .replace(/\*\*/g, "<<G>>")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/<<DS>>/g, "(?:.*/)?")
    .replace(/<<G>>/g, ".*");
  return new RegExp("^" + re + "$");
}

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
    const absRoot = isAbsolute(root) ? root : join(process.cwd(), root);
    const files: string[] = [];
    walkFiles(absRoot, files);
    const pattern = args.pattern as string;
    const rel = (f: string) => relative(absRoot, f).replace(/\\/g, "/");
    if (!pattern) return files.length ? files.map(rel).join("\n") : "(no matches)";
    const re = toRegex(pattern);
    const matched = files.filter((f) => re.test(rel(f)));
    return matched.length ? matched.map(rel).join("\n") : "(no matches)";
  },
  summarize(args) {
    return (args.path ?? args.pattern ?? "") as string;
  },
};
