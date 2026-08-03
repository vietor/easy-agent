import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolContext } from "../tools/types.js";

export function tryReadFileText(path: string): string | undefined {
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8").trim();
    if (content) return content;
  }
  return undefined;
}

/** Resolve a tool-supplied path against the run's working directory. */
export function resolvePath(ctx: ToolContext, path: string): string {
  return resolve(ctx.cwd, path);
}

