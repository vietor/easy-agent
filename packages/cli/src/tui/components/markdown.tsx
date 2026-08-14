import { Fragment, useMemo, type ReactNode } from "react";
import { Box, Text } from "ink";
import { lexer, type MarkedToken, type Token, type Tokens } from "marked";
import stringWidth from "string-width";

const HEADING_COLOR = ["magentaBright", "cyanBright", "blue", "yellow", "green", "gray"];

export function Markdown({ children }: { children: string }) {
  const tokens = useMemo(() => lexer(children, { gfm: true }) as MarkedToken[], [children]);
  return <Box flexDirection="column">{renderBlocks(tokens)}</Box>;
}

function renderBlocks(tokens: Token[]): ReactNode {
  return tokens.map((token, i) => (
    <Fragment key={i}>{renderBlock(token as MarkedToken)}</Fragment>
  ));
}

function renderBlock(token: MarkedToken): ReactNode {
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
          {renderBlocks(token.tokens)}
        </Box>
      );
    case "list":
      return renderList(token);
    case "table":
      return renderTable(token);
    case "paragraph":
      return <Text>{renderInline(token.tokens)}</Text>;
    case "text":
      return <Text>{token.tokens ? renderInline(token.tokens) : token.text}</Text>;
    case "html":
      return <Text dimColor>{token.text}</Text>;
    default:
      return null;
  }
}

function renderInline(tokens: Token[] | undefined, mode: "react" | "text" = "react"): ReactNode | string {
  if (!tokens || tokens.length === 0) return mode === "react" ? null : "";
  const inner = (t: Token[] | undefined) => renderInline(t, mode);
  const out = tokens.map((token, i) => {
    const tok = token as MarkedToken;
    switch (tok.type) {
      case "text": {
        const content = tok.tokens ? inner(tok.tokens) : tok.text;
        return mode === "react" ? <Text key={i}>{content}</Text> : content;
      }
      case "strong": {
        const content = inner(tok.tokens);
        return mode === "react" ? <Text key={i} bold>{content}</Text> : content;
      }
      case "em": {
        const content = inner(tok.tokens);
        return mode === "react" ? <Text key={i} italic>{content}</Text> : content;
      }
      case "codespan":
        return mode === "react" ? <Text key={i} color="cyan">{tok.text}</Text> : tok.text;
      case "del": {
        const content = inner(tok.tokens);
        return mode === "react" ? <Text key={i} strikethrough>{content}</Text> : content;
      }
      case "link": {
        const content = inner(tok.tokens);
        return mode === "react" ? <Text key={i} color="blue" underline>{content}</Text> : content;
      }
      case "image": {
        const content = tok.text || tok.href;
        return mode === "react" ? <Text key={i} color="magenta">{content}</Text> : content;
      }
      case "br":
        return mode === "react" ? <Text key={i}>{"\n"}</Text> : "";
      case "escape":
        return mode === "react" ? <Text key={i}>{tok.text}</Text> : tok.text;
      case "html":
        return mode === "react" ? <Text key={i} dimColor>{tok.text}</Text> : tok.text;
      default:
        return mode === "react"
          ? <Text key={i}>{(tok as { text?: string }).text ?? ""}</Text>
          : (tok as { text?: string }).text ?? "";
    }
  });
  return mode === "react" ? out : out.join("");
}

function renderList(token: Tokens.List): ReactNode {
  const markers = token.items.map((item, i) => {
    if (item.task) return item.checked ? "[x]" : "[ ]";
    if (token.ordered) return `${(token.start === "" ? i + 1 : Number(token.start) + i)}.`;
    return "•";
  });
  const markerWidth = Math.max(1, ...markers.map((s)=>stringWidth(s)));
  return (
    <Box flexDirection="column">
      {token.items.map((item, i) => (
        <Box key={i} marginTop={token.loose && i > 0 ? 1 : 0}>
          <Text>{padAlign(markers[i], markerWidth, "right")} </Text>
          <Box flexDirection="column" flexGrow={1}>
            {renderBlocks(item.tokens)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function renderTable(token: Tokens.Table): ReactNode {
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

function padAlign(text: string, width: number, align: "left" | "right" | "center" | null): string {
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
