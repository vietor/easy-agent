import { Fragment, useMemo, type ReactNode } from "react";
import { Box, Text } from "ink";
import { lexer, type MarkedToken, type Token, type Tokens } from "marked";
import stringWidth from "string-width";

const HEADING_COLOR = ["magentaBright", "cyanBright", "blue", "yellow", "green", "gray"];

export function Markdown({ children, color }: { children: string; color?: string }) {
  const tokens = useMemo(() => lexer(children, { gfm: true }) as MarkedToken[], [children]);
  return <Box flexDirection="column">{renderBlocks(tokens, color)}</Box>;
}

function renderBlocks(tokens: Token[], color?: string): ReactNode {
  return tokens.map((token, i) => (
    <Fragment key={i}>{renderBlock(token as MarkedToken, color)}</Fragment>
  ));
}

function renderBlock(token: MarkedToken, color?: string): ReactNode {
  switch (token.type) {
    case "space":
      return <Text>{" "}</Text>;
    case "hr":
      return (
        <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />
      );
    case "heading":
      return (
        <Box>
          <Text bold underline={token.depth === 1} color={HEADING_COLOR[token.depth - 1]}>
            {renderInline(token.tokens)}
          </Text>
        </Box>
      );
    case "code":
      return (
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          {token.lang ? <Text dimColor>{token.lang}</Text> : null}
          <Text>{token.text}</Text>
        </Box>
      );
    case "blockquote":
      return (
        <Box borderStyle="single" borderTop={false} borderBottom={false} borderRight={false} borderColor="gray" paddingLeft={1}>
          {renderBlocks(token.tokens, color)}
        </Box>
      );
    case "list":
      return renderList(token, color);
    case "table":
      return renderTable(token, color);
    case "paragraph":
      return <Text color={color}>{renderInline(token.tokens)}</Text>;
    case "text":
      return <Text color={color}>{token.tokens ? renderInline(token.tokens) : token.text}</Text>;
    case "html":
      return <Text dimColor>{token.text}</Text>;
    default:
      return null;
  }
}

function renderInline(tokens: Token[] | undefined): ReactNode {
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((token, i) => {
    const tok = token as MarkedToken;
    switch (tok.type) {
      case "text":
        return <Text key={i}>{tok.tokens ? renderInline(tok.tokens) : tok.text}</Text>;
      case "strong":
        return <Text key={i} bold>{renderInline(tok.tokens)}</Text>;
      case "em":
        return <Text key={i} italic>{renderInline(tok.tokens)}</Text>;
      case "codespan":
        return <Text key={i} color="cyan">{tok.text}</Text>;
      case "del":
        return <Text key={i} strikethrough>{renderInline(tok.tokens)}</Text>;
      case "link":
        return <Text key={i} color="blue" underline>{renderInline(tok.tokens)}</Text>;
      case "image":
        return <Text key={i} color="magenta">{tok.text || tok.href}</Text>;
      case "br":
        return <Text key={i}>{"\n"}</Text>;
      case "escape":
        return <Text key={i}>{tok.text}</Text>;
      case "html":
        return <Text key={i} dimColor>{tok.text}</Text>;
      default:
        return <Text key={i}>{(tok as { text?: string }).text ?? ""}</Text>;
    }
  });
}

function renderList(token: Tokens.List, color?: string): ReactNode {
  const markers = token.items.map((item, i) => {
    if (item.task) return item.checked ? "[x]" : "[ ]";
    if (token.ordered) return `${(token.start === "" ? i + 1 : Number(token.start) + i)}.`;
    return "•";
  });
  const markerWidth = Math.max(1, ...markers.map(strWidth));
  return (
    <Box flexDirection="column">
      {token.items.map((item, i) => (
        <Box key={i} marginTop={token.loose && i > 0 ? 1 : 0}>
          <Text color={color}>{padAlign(markers[i], markerWidth, "right")} </Text>
          <Box flexDirection="column" flexGrow={1}>
            {renderBlocks(item.tokens, color)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function renderTable(token: Tokens.Table, color?: string): ReactNode {
  const aligns = token.align;
  const cols = token.header.length;
  const overhead = 3 * cols + 1;
  const available = Math.max(1, (process.stdout.columns ?? 80) - 2 - overhead);
  const natural = new Array<number>(cols).fill(0);
  for (const row of [token.header, ...token.rows]) {
    for (let c = 0; c < cols; c++) {
      const w = strWidth(tokensToText(row[c].tokens));
      if (w > natural[c]) natural[c] = w;
    }
  }
  const widths = fitWidths(natural, available);
  const renderRow = (row: Tokens.TableCell[], bold = false) => {
    const wrapped = row.map((tc, c) => wrapText(tokensToText(tc.tokens), widths[c]));
    const height = Math.max(1, ...wrapped.map(lines => lines.length));
    return Array.from({ length: height }, (_, r) => (
      <Text key={r}>
        {[
          ...row.flatMap((_, c) => [
            <Text key={`s${c}`} dimColor>│</Text>,
            <Text key={`c${c}`} color={color} bold={bold}>{` ${padAlign(wrapped[c][r] ?? "", widths[c], aligns[c])} `}</Text>,
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

function tokensToText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return tokens.map(tokenToText).join("");
}

function tokenToText(token: Token): string {
  const t = token as MarkedToken;
  switch (t.type) {
    case "text":
      return t.tokens ? tokensToText(t.tokens) : t.text;
    case "strong":
    case "em":
    case "del":
      return tokensToText(t.tokens);
    case "codespan":
      return t.text;
    case "link":
      return tokensToText(t.tokens);
    case "image":
      return t.text || t.href;
    case "br":
      return "";
    case "escape":
      return t.text;
    case "html":
      return t.text;
    default:
      return (t as { text?: string }).text ?? "";
  }
}

function padAlign(text: string, width: number, align: "left" | "right" | "center" | null): string {
  const pad = Math.max(0, width - strWidth(text));
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") return " ".repeat(Math.floor(pad / 2)) + text + " ".repeat(Math.ceil(pad / 2));
  return text + " ".repeat(pad);
}

function strWidth(s: string): number {
  return stringWidth(s);
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
  if (width <= 0 || strWidth(text) <= width) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  for (const word of words) {
    const w = strWidth(word);
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
        const cw = strWidth(ch);
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
