import { ProxyAgent, type Dispatcher } from "undici";

let proxyAgent: ProxyAgent | null | undefined;
let noProxyList: string[] | undefined;
let proxyInitialized = false;

function ensureProxy() {
  proxyInitialized = true;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;

  const proxyUrl = httpsProxy || httpProxy;
  proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  noProxyList = noProxy?.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function netFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!proxyInitialized) ensureProxy();

  if (!proxyAgent) return fetch(input, init);

  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (noProxyList) {
    const hostname = new URL(url).hostname;
    const shouldBypass = noProxyList.some((p) => {
      if (p.startsWith(".")) return hostname.endsWith(p);
      return hostname === p || hostname.endsWith("." + p);
    });
    if (shouldBypass) return fetch(input, init);
  }

  return fetch(input, { ...init, dispatcher: proxyAgent } as RequestInit & { dispatcher: Dispatcher });
}
