import { isAbsolute, join } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { runProcess } from "./process.js";

export function resolveCwd(path?: string): string {
  const root = path || ".";
  return isAbsolute(root) ? root : join(process.cwd(), root);
}

export async function runRgLines(args: string[], cwd: string, signal?: AbortSignal): Promise<string[]> {
  const rgArgs = ["--hidden", "--path-separator", "/", "-g", "!.git/**", "-g", "!node_modules/**", ...args];
  const r = await runProcess(rgPath, rgArgs, { cwd }, signal);
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== 1) {
    throw new Error((r.stderr || "").trim() || `ripgrep exited with ${r.status}`);
  }
  return r.stdout.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
}
