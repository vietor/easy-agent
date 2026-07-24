const timeFormatter = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
  maximumFractionDigits: 1,
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

export function getContentBytes(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}
