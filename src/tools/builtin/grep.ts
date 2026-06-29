import { readFileSync } from "node:fs";
import { relative, isAbsolute, join } from "node:path";
import { walkFiles } from "../../util/fs.js";
import type { Tool } from "../types.js";

const DESCRIPTION = [
  "Search file contents under a directory recursively for a regex pattern (JavaScript RegExp syntax).",
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
    const absRoot = isAbsolute(root) ? root : join(process.cwd(), root);
    const re = new RegExp(args.pattern as string);
    const files: string[] = [];
    walkFiles(absRoot, files);
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
  summarize(args) {
    return (args.path ?? args.pattern ?? "") as string;
  },
};
