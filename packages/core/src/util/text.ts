import TurndownService from "turndown";
import type { TextResult } from "./types.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});
turndown.remove(["script", "style", "title", "meta", "head", "noscript", "template", "link", "base"]);

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

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

export function formatSeconds(value: number) {
  if (!value) return "0s";
  return secondsFormatter.format(value);
}

export function formatCompactNumber(value: number) {
  if (!value) return "0";
  return compactNumberFormatter.format(value);
}

export function getTextBytes(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

export function ellipsisText(content: string, length: number, showChars?: boolean) {
  const text = content.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  const truncated = text.slice(0, length) + "…";
  return showChars ? `${truncated} (${text.length})` : truncated;
}

export function summaryBytes(prefix: string, result: TextResult, failText: string): string {
  if (result.isError) return failText;
  return `${prefix} ${formatCompactNumber(getTextBytes(result.content))} bytes`;
}

export function summaryCount(word: "file" | "match", count: number, isError: boolean, failText: string): string {
  if (isError) return failText;
  const plural = word === "match" ? "matches" : "files";
  return `Found ${count} ${count === 1 ? word : plural}`;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
