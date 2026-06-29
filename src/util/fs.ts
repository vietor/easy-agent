import { existsSync, readFileSync } from "node:fs";

export function readFirstExistingFileContent(paths: string[]): string | undefined {
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  return undefined;
}
