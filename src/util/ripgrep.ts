import { isAbsolute, join } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { runProcess } from "./process.js";

export async function runRg(args: string[], cwd: string): Promise<string> {
  const r = await runProcess(rgPath, args, { cwd });
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== 1) {
    throw new Error((r.stderr || "").trim() || `ripgrep exited with ${r.status}`);
  }
  return r.stdout;
}

export function resolveCwd(path?: string): string {
  const root = path || ".";
  return isAbsolute(root) ? root : join(process.cwd(), root);
}

export async function runRgLines(args: string[], cwd: string): Promise<string[]> {
  const out = await runRg(args, cwd);
  return out.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
}
