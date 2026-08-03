import type { Tool } from "./types.js";
import { netFetch } from "../util/net.js";
import { isTimeout, timeoutSignal } from "../util/async.js";
import { MAX_READ_BYTES, REQUEST_TIMEOUT_MS } from "../util/constants.js";
import { previewBytes, htmlToMarkdown } from "../util/text.js";

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

const DESCRIPTION = "Fetch a URL via HTTP GET. Returns raw text for JSON/XML/text; converts HTML to markdown. Rejects binary content and bodies over 10MB. GET only; no custom headers or request body. Follows redirects.";

async function readTextBounded(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`response body exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

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
    const signal = timeoutSignal(ctx.signal, REQUEST_TIMEOUT_MS);
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
        signal,
      });
    } catch (e) {
      if (isTimeout(signal)) {
        throw new Error(`fetch ${url} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw new Error(`failed to fetch ${url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const contentType = res.headers.get("content-type") || "";
    const mime = mimeFrom(contentType);
    if (!isTextualMime(mime)) throw new Error(`unsupported content type: ${mime} for ${url}`);
    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_READ_BYTES) {
      throw new Error(`content too large: ${contentLength} bytes for ${url} (limit ${MAX_READ_BYTES})`);
    }
    const body = await readTextBounded(res, MAX_READ_BYTES);
    if (!mime.includes("html")) return body;
    return htmlToMarkdown(body);
  },
  getPreview(result) {
    return previewBytes("Fetched", result, "Fetch failed");
  },
  summaryArg: "url",
};
