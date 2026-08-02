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
