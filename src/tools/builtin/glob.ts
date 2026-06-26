import { readdirSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import type { Tool } from "../types.js";

function walk(dir: string, root: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git") continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).replace(/\\/g, "/"));
  }
}

function toRegex(pattern: string): RegExp {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "<<DS>>")
    .replace(/\*\*/g, "<<G>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<DS>>/g, "(?:.*/)?")
    .replace(/<<G>>/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp("^" + re + "$");
}

export const globTool: Tool = {
  name: "Glob",
  description: "List files under a directory, optionally filtered by a glob pattern (e.g. **/*.ts); omit pattern to list every file. Skips node_modules and .git. Returns paths relative to the root, one per line.",
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
    walk(absRoot, absRoot, files);
    const pattern = args.pattern as string;
    if (!pattern) return files.length ? files.join("\n") : "(no matches)";
    const re = toRegex(pattern);
    const matched = files.filter((f) => re.test(f));
    return matched.length ? matched.join("\n") : "(no matches)";
  },
  summarize(args) {
    return (args.path ?? args.pattern ?? "") as string;
  },
};
