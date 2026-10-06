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

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export function imageMediaType(buffer: Buffer, bufferSize: number): ImageMediaType | undefined {
  const size = Math.min(buffer.length, bufferSize);
  if (size >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (size >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (size >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (
    size >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

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
