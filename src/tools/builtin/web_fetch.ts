import { Parser } from "htmlparser2";
import TurndownService from "turndown";
import type { Tool } from "../types.js";

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "title",
  "meta",
  "link",
  "base",
]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "br",
  "tr",
  "table",
  "blockquote",
  "pre",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
]);

function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToText(html: string): string {
  let out = "";
  let skip = 0;
  const parser = new Parser({
    onopentag(name) {
      if (SKIP_TAGS.has(name)) skip++;
      else if (name === "li") out += "\n- ";
      else if (BLOCK_TAGS.has(name)) out += "\n";
    },
    onclosetag(name) {
      if (SKIP_TAGS.has(name) && skip > 0) skip--;
    },
    ontext(text) {
      if (skip === 0) out += text;
    },
  });
  parser.write(html);
  parser.end();
  return normalize(out);
}

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});
turndown.remove([
  "script",
  "style",
  "title",
  "meta",
  "head",
  "noscript",
  "template",
  "link",
  "base",
]);

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

function mimeFrom(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isTextualMime(mime: string): boolean {
  return (
    !mime ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  );
}

const DESCRIPTION = [
  "Fetch a URL via GET and return its content as markdown (default) or plain text.",
  "Follows redirects.",
  "HTML is converted; other textual types (JSON, XML, plain text) are returned raw; non-textual content (images, binaries) is rejected.",
].join(" ");

export const webFetchTool: Tool = {
  name: "WebFetch",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "full URL including scheme (http or https)",
      },
      format: {
        type: "string",
        description: "output format: 'markdown' (default) or 'text'",
      },
    },
    required: ["url"],
  },
  async execute(args) {
    const url = args.url as string;
    const format = ((args.format as string) || "markdown").toLowerCase();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      });
    } catch (e) {
      return `Error: failed to fetch ${url}: ${(e as Error).message}`;
    }
    if (!res.ok) return `Error: ${res.status} ${res.statusText} for ${url}`;
    const body = await res.text();
    const contentType  = res.headers.get("content-type") || "";
    const mime = mimeFrom(contentType);
    if (!isTextualMime(mime)) return `Error: unsupported content type: ${mime} for ${url}`;
    if (!contentType.includes("html")) return body;
    return format === "text" ? htmlToText(body) : htmlToMarkdown(body);
  },
  summarize(args) {
    return (args.url as string) ?? "";
  },
};
