import type { Tool } from "./types.js";
import { netFetch } from "../util/net.js";
import { backoffDelay, isAbortError, withRetry, withTimeoutFn } from "../util/async.js";
import { MAX_WEB_FETCH_MB, mbToBytes, REQUEST_TIMEOUT_MS, WEB_FETCH_RETRIES } from "../util/constants.js";
import { htmlToMarkdown } from "../util/html.js";
import { toErrorMessage, summaryBytes } from "../util/text.js";

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

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_WEB_FETCH_BYTES = mbToBytes(MAX_WEB_FETCH_MB);
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  "Accept": "text/markdown,text/html,text/plain,application/xhtml+xml,application/xml,application/json;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
};

const DESCRIPTION = `Fetch a URL via HTTP GET. Returns raw text for JSON/XML/text; converts HTML to markdown. Rejects binary content and bodies over ${MAX_WEB_FETCH_MB}MB. Retries transient failures (network, timeouts, 429/5xx) up to ${WEB_FETCH_RETRIES + 1} attempts. GET only; no custom headers or request body. Follows redirects.`;

class WebFetchError extends Error {}

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

async function fetchOne(url: string, signal: AbortSignal | undefined): Promise<string> {
  const res = await withTimeoutFn(
    (s) => netFetch(url, { headers: REQUEST_HEADERS, redirect: "follow", signal: s }),
    REQUEST_TIMEOUT_MS,
    signal,
    `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
  ).catch((e) => {
    if (isAbortError(e)) throw e;
    throw new WebFetchError(`failed to fetch ${url}: ${toErrorMessage(e)}`);
  });
  if (!res.ok) {
    const message = `${res.status} ${res.statusText} for ${url}`;
    if (RETRYABLE_STATUS.has(res.status)) throw new WebFetchError(message);
    throw new Error(message);
  }
  const contentType = res.headers.get("content-type") || "";
  const mime = mimeFrom(contentType);
  if (!isTextualMime(mime)) throw new Error(`unsupported content type: ${mime} for ${url}`);
  const contentLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEB_FETCH_BYTES) {
    throw new Error(`content too large: ${contentLength} bytes for ${url} (limit ${MAX_WEB_FETCH_BYTES})`);
  }
  const body = await readTextBounded(res, MAX_WEB_FETCH_BYTES);
  if (!mime.includes("html")) return body;
  return htmlToMarkdown(body);
}

export const webFetchTool: Tool = {
  name: "WebFetch",
  readOnly: true,
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
    return {
      content: await withRetry(
        () => fetchOne(url, ctx.signal),
        {
          retries: WEB_FETCH_RETRIES,
          retryable: (e) => e instanceof WebFetchError,
          backoff: backoffDelay,
          signal: ctx.signal,
        }
      ),
    };
  },
  summarizeResult(result) {
    return summaryBytes("Fetched", result, "Fetch failed");
  },
  summaryKeys: ["url"],
};
