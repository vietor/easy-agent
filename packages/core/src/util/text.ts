import TurndownService from "turndown";

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

export interface PreviewResult {
  content: string;
  isError?: boolean;
}

export function previewBytes(prefix: string, result: PreviewResult, failText: string): string {
  if (result.isError) return failText;
  return `${prefix} ${formatCompactNumber(getTextBytes(result.content))} bytes`;
}

export function previewCount(word: "file" | "match", count: number, isError: boolean, failText: string): string {
  if (isError) return failText;
  const plural = word === "match" ? "matches" : "files";
  return `Found ${count} ${count === 1 ? word : plural}`;
}

/** Trailing marker line appended when tool output was cut short (by a head limit or the 10MB buffer cap). */
export const TRUNCATION_MARKER = "(output truncated)";

export function lineCount(content: string): number {
  return content === "" ? 0 : (content.match(/\n/g) || []).length + 1;
}

/** Line count of tool output, excluding a trailing truncation marker. */
export function visibleLineCount(content: string): number {
  const lines = content.split("\n").filter((l) => l);
  return lines.length - (lines[lines.length - 1] === TRUNCATION_MARKER ? 1 : 0);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
