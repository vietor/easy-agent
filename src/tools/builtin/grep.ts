import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import type { Tool } from "../types.js";

function walkFiles(dir: string, root: string, out: string[]): void {
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
    if (st.isDirectory()) walkFiles(full, root, out);
    else out.push(full);
  }
}

export const grepTool: Tool = {
  name: "grep",
  description: "Search file contents under a directory for a regex pattern.",
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
    const re = new RegExp(args.pattern as string);
    const files: string[] = [];
    walkFiles(absRoot, absRoot, files);
    const results: string[] = [];
    for (const f of files) {
      let content: string;
      try {
        content = readFileSync(f, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push(`${relative(absRoot, f).replace(/\\/g, "/")}:${i + 1}: ${lines[i]}`);
          if (results.length >= 200) return results.join("\n") + "\n(truncated)";
        }
      }
    }
    return results.length ? results.join("\n") : "(no matches)";
  },
};
