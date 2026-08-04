import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function tryReadFileText(path: string): string | undefined {
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8").trim();
    if (content) return content;
  }
  return undefined;
}

export function requirePath(args: Record<string, unknown>, cwd: string): string {
  const path = args.path;
  if (typeof path !== "string" || !path) throw new Error("path is required");
  return resolve(cwd, path);
}

