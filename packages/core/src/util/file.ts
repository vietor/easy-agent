import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { IMAGE_TOKEN_ESTIMATE } from "./constants.js";

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
const PIXELS_PER_TOKEN = 750;
const IMAGE_MAX_EDGE = 1568;

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

export function imageDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  const type = imageMediaType(buffer, buffer.length);
  if (type === "image/png") return pngDimensions(buffer);
  if (type === "image/jpeg") return jpegDimensions(buffer);
  if (type === "image/gif") return gifDimensions(buffer);
  if (type === "image/webp") return webpDimensions(buffer);
  return undefined;
}

export function estimateImageTokens(buffer: Buffer): number {
  const dims = imageDimensions(buffer);
  if (!dims) return IMAGE_TOKEN_ESTIMATE;
  const longEdge = Math.max(dims.width, dims.height);
  const scale = longEdge > IMAGE_MAX_EDGE ? IMAGE_MAX_EDGE / longEdge : 1;
  return Math.ceil((dims.width * scale * dims.height * scale) / PIXELS_PER_TOKEN);
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  let pos = 2;
  while (pos + 9 <= buffer.length) {
    if (buffer[pos] !== 0xff) return undefined;
    const marker = buffer[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      pos += 2;
      continue;
    }
    if ((marker & 0xf0) === 0xc0 && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buffer.readUInt16BE(pos + 7), height: buffer.readUInt16BE(pos + 5) };
    }
    const length = buffer.readUInt16BE(pos + 2);
    if (length < 2) return undefined;
    pos += 2 + length;
  }
  return undefined;
}

function gifDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 10) return undefined;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  const variant = buffer.toString("ascii", 12, 16);
  if (variant === "VP8X" && buffer.length >= 30) {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (variant === "VP8 " && buffer.length >= 30) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (variant === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
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
