const secondsFormatter = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
  maximumFractionDigits: 2,
});

import { MAX_SUMMARY_LENGTH } from "./constants.js";

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

export function countNonEmptyLines(content: string): number {
  return content.split("\n").filter((l) => l).length;
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

export function summaryCount(word: "file" | "match", count: number, isError: boolean, failText: string): string {
  if (isError) return failText;
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
