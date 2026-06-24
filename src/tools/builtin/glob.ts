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
    .replace(/\*\*/g, "<<G>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<G>>/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp("^" + re + "$");
}

export const globTool: Tool = {
  name: "glob",
  description: "Find files under a directory matching a glob pattern (e.g. **/*.ts).",
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
    const absRoot = isAbsolute(root) ? root : join(process.cwd(), root);
    const files: string[] = [];
    walk(absRoot, absRoot, files);
    const re = toRegex(args.pattern as string);
    const matched = files.filter((f) => re.test(f));
    return matched.length ? matched.join("\n") : "(no matches)";
  },
};
