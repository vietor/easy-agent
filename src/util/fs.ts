import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function walkFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
}

export function readFirstExistingFileContent(paths: string[]): string | undefined {
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  return undefined;
}
