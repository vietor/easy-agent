import { resolve } from "node:path";
import type { ToolContext } from "./types.js";

/** Resolve a tool-supplied path against the run's working directory. */
export function resolvePath(ctx: ToolContext, path: string): string {
  return resolve(ctx.cwd, path);
}
