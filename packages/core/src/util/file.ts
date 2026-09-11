import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function tryReadFileText(path: string): string | undefined {
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8").trim();
    if (content) return content;
  }
  return undefined;
}

export function resolveSearchPath(path: string | undefined, cwd: string): { cwd: string; target: string } {
  const resolved = resolve(cwd, path ?? "");
  if (existsSync(resolved) && !statSync(resolved).isDirectory()) {
    return { cwd, target: resolved };
  }
  return { cwd: resolved, target: "." };
}

const BINARY_SCAN_BYTES = 8 * 1024;

export function isBinaryContent(buffer: Buffer, bufferSize: number): boolean {
  const scanSize = Math.min(buffer.length, BINARY_SCAN_BYTES, bufferSize);

  let count = 0;
  for (let i = 0; i < scanSize; i++) {
    const byte = buffer[i];
    if (byte === 0) {
      return true;
    }

    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      count++;
    }
  }

  return count / scanSize > 0.1;
}
