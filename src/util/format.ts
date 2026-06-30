const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export function compactDisplay(value: number) {
  if (!value || isNaN(value)) return "0";
  return compactFormatter.format(value);
}
