import { existsSync, readFileSync } from "node:fs";

export function readFirstExistingFileContent(paths: string[]): string | undefined {
  for (const p of paths) {
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8").trim();
      if (content) return content;
    }
  }
  return undefined;
}
