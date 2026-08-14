import { Text } from "ink";
import type { ReactNode } from "react";
import type { MarkedToken, Token } from "marked";

export function renderInline(tokens: Token[] | undefined, mode: "react" | "text" = "react"): ReactNode | string {
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
