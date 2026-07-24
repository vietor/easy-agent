import TurndownService from "turndown";
import type { Tool } from "./types.js";
import { netFetch } from "../util/net.js";


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

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

function mimeFrom(contentType: string): string {
  return contentType.split(";", 1)[0].trim().toLowerCase();
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

const DESCRIPTION = "Fetch a URL via GET and return content as markdown. Follows redirects. HTML is converted; JSON/XML/text returned raw; binaries rejected.";

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
    },
    required: ["url"],
  },
  async execute(args, ctx) {
    const url = args.url as string;
    let res: Response;
    try {
      res = await netFetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          "Accept": "text/markdown,text/html,text/plain,application/xhtml+xml,application/xml,application/json;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Cache-Control": "no-cache",
        },
        redirect: "follow",
        signal: ctx.signal,
      });
    } catch (e) {
      throw new Error(`failed to fetch ${url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const body = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const mime = mimeFrom(contentType);
    if (!isTextualMime(mime)) throw new Error(`unsupported content type: ${mime} for ${url}`);
    if (!contentType.includes("html")) return body;
    return htmlToMarkdown(body);
  },
  summaryArg: "url",
};
