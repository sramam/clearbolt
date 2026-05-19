import { ProxyAgent, fetch as undiciFetch } from "undici";
import { URL } from "node:url";
import type { FetchRequest, RawResponse } from "@clearbolt/core";
import type { Fetcher } from "./fetcher.js";
import { requestUrlFollowRedirects } from "./https-get.js";
import {
  type ProxyTier,
  proxyDispatcherUrl,
  proxyTierForHost,
} from "./proxy-config.js";
import { getHttpsAgentWithAiaForHost } from "./tls-aia.js";

const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

function isTlsAiaCandidateError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { reason?: string };
  if (e?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return true;
  const msg = `${e?.message ?? ""}${e.reason ?? ""}`;
  return /unable to verify the first certificate|unable to get local issuer certificate/i.test(
    msg,
  );
}

export type HttpFetcherOptions = {
  /** Sticky session id (appended to proxy username when configured). */
  sessionKey?: string;
  /** Force a proxy tier for this fetcher instance. */
  proxyTier?: ProxyTier;
};

export class HttpFetcher implements Fetcher {
  constructor(private readonly options: HttpFetcherOptions = {}) {}

  async fetch(req: FetchRequest): Promise<RawResponse> {
    const u = new URL(req.url);
    const headers = { ...DEFAULT_HEADERS, ...req.headers };
    const tier =
      this.options.proxyTier ??
      proxyTierForHost(u.hostname, this.options.sessionKey);
    const proxyUrl = proxyDispatcherUrl(tier, this.options.sessionKey);
    if (proxyUrl) {
      return fetchViaProxy(req.url, headers, proxyUrl);
    }
    if (u.protocol === "http:") {
      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers,
        redirect: "follow",
      });
      const body = await res.text();
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v: string, k: string) => {
        outHeaders[k] = v;
      });
      return {
        status: res.status,
        body,
        finalUrl: res.url,
        headers: outHeaders,
      };
    }
    if (u.protocol !== "https:") {
      throw new Error(`HttpFetcher: unsupported URL protocol ${u.protocol}`);
    }
    const port = u.port ? Number.parseInt(u.port, 10) : 443;
    try {
      return await requestUrlFollowRedirects(req.url, {
        headers,
        maxRedirects: 5,
      });
    } catch (err) {
      if (!isTlsAiaCandidateError(err)) throw err;
      const agent = await getHttpsAgentWithAiaForHost(u.hostname, port);
      return await requestUrlFollowRedirects(req.url, {
        headers,
        httpsAgent: agent,
        maxRedirects: 5,
      });
    }
  }
}

function proxyConnectTimeoutMs(): number {
  const n = Number.parseInt(
    process.env.CLEARBOLT_PROXY_CONNECT_TIMEOUT_MS ?? "60000",
    10,
  );
  return Number.isNaN(n) ? 60_000 : Math.max(10_000, n);
}

function proxyBodyTimeoutMs(): number {
  const n = Number.parseInt(
    process.env.CLEARBOLT_PROXY_BODY_TIMEOUT_MS ?? "120000",
    10,
  );
  return Number.isNaN(n) ? 120_000 : Math.max(30_000, n);
}

async function fetchViaProxy(
  url: string,
  headers: Record<string, string>,
  proxyUrl: string,
): Promise<RawResponse> {
  const dispatcher = new ProxyAgent({
    uri: proxyUrl,
    connectTimeout: proxyConnectTimeoutMs(),
    bodyTimeout: proxyBodyTimeoutMs(),
  });
  try {
    const res = await undiciFetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      dispatcher,
    });
    const body = await res.text();
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    return {
      status: res.status,
      body,
      finalUrl: res.url,
      headers: outHeaders,
    };
  } finally {
    await dispatcher.close();
  }
}
