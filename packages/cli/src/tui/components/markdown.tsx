import { Fragment, useMemo, type ReactNode } from "react";
import { Box, Text } from "ink";
import { lexer, type MarkedToken, type Token, type Tokens } from "marked";
import stringWidth from "string-width";
import { renderInline } from "./markdown-inline.js";
import { padAlign, renderTable } from "./markdown-table.js";

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
