const timeFormatter = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function timeFormat(value: number) {
  if (!value) return "0s";
  return timeFormatter.format(value);
}

export function compactFormat(value: number) {
  if (!value) return "0";
  return compactFormatter.format(value);
}

export function getTextBytes(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

export function ellipsisText(content: string, length: number) {
  const text = content.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return text.length > length ? text.slice(0, length) + "…" : text;
}

export interface PreviewResult {
  content: string;
  isError?: boolean;
}

export function previewBytes(prefix: string, result: PreviewResult, failText: string): string {
  if (result.isError) return failText;
  return `${prefix} ${compactFormat(getTextBytes(result.content))} bytes`;
}

export function previewCount(word: "file" | "match", count: number, isError: boolean, failText: string): string {
  if (isError) return failText;
  const plural = word === "match" ? "matches" : "files";
  return `Found ${count} ${count === 1 ? word : plural}`;
}

/** Trailing marker line appended when tool output was cut short (by a head limit or the 10MB buffer cap). */
export const TRUNCATION_MARKER = "(output truncated)";

/** Line count of tool output, excluding a trailing truncation marker. */
export function visibleLineCount(content: string): number {
  const lines = content.split("\n").filter((l) => l);
  return lines.length - (lines[lines.length - 1] === TRUNCATION_MARKER ? 1 : 0);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
