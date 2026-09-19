import {
  JSON_SHAPE_MAX_DEPTH,
  JSON_SHAPE_MAX_KEYS,
  MAX_JSON_SAMPLE_BYTES,
  MAX_SUMMARY_LENGTH,
} from "./constants.js";

const secondsFormatter = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
  maximumFractionDigits: 2,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatDuration(value: number) {
  if (!value) return "0s";
  if (value < 60) return secondsFormatter.format(value);
  const total = Math.round(value);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function formatCompactNumber(value: number) {
  if (!value) return "0";
  return compactNumberFormatter.format(value);
}

export function getTextBytes(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

const NON_ASCII = /[^\x00-\x7f]/;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (!NON_ASCII.test(text)) return Math.round(text.length / 4);
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) < 0x80 ? 1 : 4;
  }
  return Math.round(tokens / 4);
}

export function trimLeftNewlines(content: string | null) {
  if(!content) return '';
  return content.replace(/^[\r\n]+/, '');
}

export function trimSurroundingNewlines(content: string | null) {
  if(!content) return '';
  return content.replace(/^[\r\n]+|[\r\n]+$/g, '');
}

export function countNonEmptyLines(content: string): number {
  return content.split("\n").filter((l) => l).length;
}

function countAllLines(content: string): number {
  let lines = 1;
  for (let i = content.indexOf("\n"); i !== -1; i = content.indexOf("\n", i + 1)) lines++;
  return lines;
}

function nthNewline(text: string, n: number): number {
  let index = -1;
  for (let i = 0; i < n; i++) index = text.indexOf("\n", index + 1);
  return index;
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
  totalBytes: number;
  totalLines: number;
  keptLines: number;
}

export function truncateOutput(
  content: string,
  direction: "head" | "tail",
  maxBytes: number,
  maxLines: number
): TruncateResult {
  const totalBytes = getTextBytes(content);
  const totalLines = countAllLines(content);
  if (totalBytes <= maxBytes && totalLines <= maxLines) {
    return { text: content, truncated: false, totalBytes, totalLines, keptLines: totalLines };
  }

  const buf = Buffer.from(direction === "head" ? content.slice(0, maxBytes) : content.slice(-maxBytes), "utf-8");
  let start = 0;
  let end = buf.length;
  if (direction === "head") {
    if (end > maxBytes) {
      end = maxBytes;
      while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
      const boundary = buf.lastIndexOf(0x0a, end);
      if (boundary > 0) end = boundary;
    }
  } else if (buf.length > maxBytes) {
    start = buf.length - maxBytes;
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
    const boundary = buf.indexOf(0x0a, start);
    if (boundary >= 0) start = boundary + 1;
  }
  let text = buf.subarray(start, end).toString("utf-8");
  const lines = countAllLines(text);
  if (lines > maxLines) {
    const cut = nthNewline(text, direction === "head" ? maxLines : lines - maxLines);
    text = direction === "head" ? text.slice(0, cut) : text.slice(cut + 1);
  }
  return { text, truncated: true, totalBytes, totalLines, keptLines: Math.min(lines, maxLines) };
}

function describeShape(value: unknown, depth: number): string {
  if (Array.isArray(value)) {
    return value.length ? `[${describeShape(value[0], depth)}]` : "[]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "{}";
    if (depth <= 0) return "{…}";
    const shown = entries
      .slice(0, JSON_SHAPE_MAX_KEYS)
      .map(([key, item]) => `${key}: ${describeShape(item, depth - 1)}`);
    if (entries.length > JSON_SHAPE_MAX_KEYS) shown.push("…");
    return `{${shown.join(", ")}}`;
  }
  return value === null ? "null" : typeof value;
}

export function jsonShape(value: unknown): string {
  return describeShape(value, JSON_SHAPE_MAX_DEPTH);
}

export function jsonSample(value: unknown): string | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const sample = JSON.stringify(value[0]);
  return getTextBytes(sample) <= MAX_JSON_SAMPLE_BYTES ? sample : undefined;
}

export function summarizeText(content: string, length: number, showChars?: boolean) {
  const text = content.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  const truncated = text.slice(0, length) + "…";
  return showChars ? `${truncated} (${text.length})` : truncated;
}

export function summaryBytes(prefix: string, result: { content: string; isError?: boolean }, failText: string): string {
  if (result.isError) return failText;
  return `${prefix} ${formatCompactNumber(getTextBytes(result.content))} bytes`;
}

export function summaryCount(word: "file" | "match", count: number): string {
  const plural = word === "match" ? "matches" : "files";
  return `Found ${count} ${count === 1 ? word : plural}`;
}

export function defaultResultSummary(result: { content: string; isError?: boolean }): string {
  if (result.isError) {
    return summarizeText(result.content, MAX_SUMMARY_LENGTH);
  }
  const bytes = getTextBytes(result.content);
  const lines = countNonEmptyLines(result.content);
  return `Retrieved ${formatCompactNumber(bytes)} bytes, ${formatCompactNumber(lines)} lines`;
}

export function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
