import { spawnSync } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";

export function runRg(args: string[], cwd: string): string {
  const r = spawnSync(rgPath, args, { encoding: "utf-8", cwd, maxBuffer: 10 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== 1) {
    throw new Error((r.stderr || "").trim() || `ripgrep exited with ${r.status}`);
  }
  return r.stdout ?? "";
}
