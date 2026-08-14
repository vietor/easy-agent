import { Fragment, type ReactNode } from "react";
import { Box, Text } from "ink";
import type { Tokens } from "marked";
import stringWidth from "string-width";
import { renderInline } from "./markdown-inline.js";

export function renderTable(token: Tokens.Table): ReactNode {
  const aligns = token.align;
  const cols = token.header.length;
  const overhead = 3 * cols + 1;
  const available = Math.max(1, (process.stdout.columns ?? 80) - 2 - overhead);
  const natural = new Array<number>(cols).fill(0);
  for (const row of [token.header, ...token.rows]) {
    for (let c = 0; c < cols; c++) {
      const w = stringWidth(renderInline(row[c].tokens, "text") as string);
      if (w > natural[c]) natural[c] = w;
    }
  }
  const widths = fitWidths(natural, available);
  const renderRow = (row: Tokens.TableCell[], bold = false) => {
    const wrapped = row.map((tc, c) => wrapText(renderInline(tc.tokens, "text") as string, widths[c]));
    const height = Math.max(1, ...wrapped.map(lines => lines.length));
    return Array.from({ length: height }, (_, r) => (
      <Text key={r}>
        {[
          ...row.flatMap((_, c) => [
            <Text key={`s${c}`} dimColor>│</Text>,
            <Text key={`c${c}`} bold={bold}>{` ${padAlign(wrapped[c][r] ?? "", widths[c], aligns[c])} `}</Text>,
          ]),
          <Text key="e" dimColor>│</Text>,
        ]}
      </Text>
    ));
  };
  const border = (l: string, m: string, r: string) =>
    l + widths.map(w => "─".repeat(w + 2)).join(m) + r;
  return (
    <Box flexDirection="column">
      <Text dimColor>{border("┌", "┬", "┐")}</Text>
      <Fragment>{renderRow(token.header, true)}</Fragment>
      <Text dimColor>{border("├", "┼", "┤")}</Text>
      {token.rows.map((row, i) => (
        <Fragment key={i}>{renderRow(row)}</Fragment>
      ))}
      <Text dimColor>{border("└", "┴", "┘")}</Text>
    </Box>
  );
}

export function padAlign(text: string, width: number, align: "left" | "right" | "center" | null): string {
  const pad = Math.max(0, width - stringWidth(text));
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") return " ".repeat(Math.floor(pad / 2)) + text + " ".repeat(Math.ceil(pad / 2));
  return text + " ".repeat(pad);
}

function fitWidths(widths: number[], available: number): number[] {
  const fitted = widths.slice();
  let total = fitted.reduce((a, b) => a + b, 0);
  if (total <= available) return fitted;
  while (total > available) {
    let max = 0;
    for (let i = 1; i < fitted.length; i++) if (fitted[i] > fitted[max]) max = i;
    if (fitted[max] <= 1) break;
    fitted[max]--;
    total--;
  }
  return fitted;
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0 || stringWidth(text) <= width) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  for (const word of words) {
    const w = stringWidth(word);
    if (lineW > 0 && lineW + 1 + w <= width) {
      line += " " + word;
      lineW += 1 + w;
    } else if (w <= width) {
      if (lineW > 0) lines.push(line);
      line = word;
      lineW = w;
    } else {
      if (lineW > 0) lines.push(line);
      line = "";
      lineW = 0;
      let cur = "";
      let curW = 0;
      for (const ch of word) {
        const cw = stringWidth(ch);
        if (cur && curW + cw > width) {
          lines.push(cur);
          cur = ch;
          curW = cw;
        } else {
          cur += ch;
          curW += cw;
        }
      }
      line = cur;
      lineW = curW;
    }
  }
  if (lineW > 0 || lines.length === 0) lines.push(line);
  return lines;
}
