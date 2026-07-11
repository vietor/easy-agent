import { existsSync, readFileSync } from "node:fs";

export function tryReadFileText(path: string): string | undefined {
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8").trim();
    if (content) return content;
  }
  return undefined;
}

export function readFirstFileContent<T>(paths: string[], fn: (t: string) => T): T | undefined {
  for (const p of paths) {
    const content = fn(p);
    if (content) return content;
  }
  return undefined;
}
