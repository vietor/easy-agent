import { isAbsolute, join } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { runProcess } from "./subprocess.js";
import { REQUEST_TIMEOUT_MS } from "./constants.js";

export function resolveCwd(path: string, base: string): string {
  const root = path || ".";
  return isAbsolute(root) ? root : join(base, root);
}

export interface RgLinesResult {
  lines: string[];
  truncated: boolean;
}

export async function runRgLines(args: string[], cwd: string, signal?: AbortSignal, limit?: number): Promise<RgLinesResult> {
  const rgArgs = ["--hidden", "--path-separator", "/", "-g", "!.git/**", "-g", "!node_modules/**", ...args];
  const r = await runProcess(rgPath, rgArgs, { cwd, timeout: REQUEST_TIMEOUT_MS }, signal);
  if (!r.truncated && (r.error || (r.status !== 0 && r.status !== 1))) {
    throw r.error ?? new Error((r.stderr || "").trim() || `ripgrep exited with ${r.status}`);
  }
  let kept = r.stdout.split("\n").filter(Boolean);
  let truncated = r.truncated === true;
  if (limit !== undefined && kept.length > limit) {
    kept = kept.slice(0, limit);
    truncated = true;
  }
  return { lines: kept.map((f) => f.replace(/^\.\//, "")), truncated };
}
