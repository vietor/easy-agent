const timeFormatter = new Intl.NumberFormat("en-US", { style: "unit", unit: "second", unitDisplay: "narrow" });
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export function timeDisplay(value: number) {
  if (!value) return "0s";
  return timeFormatter.format(value);
}

export function compactDisplay(value: number) {
  if (!value) return "0";
  return compactFormatter.format(value);
}
