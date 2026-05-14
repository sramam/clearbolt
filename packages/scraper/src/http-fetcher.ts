import type { FetchRequest, RawResponse } from "@clearbolt/core";
import type { Fetcher } from "./fetcher.js";

const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export class HttpFetcher implements Fetcher {
  async fetch(req: FetchRequest): Promise<RawResponse> {
    const res = await fetch(req.url, {
      method: req.method ?? "GET",
      headers: { ...DEFAULT_HEADERS, ...req.headers },
      redirect: "follow",
    });
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v: string, k: string) => {
      headers[k] = v;
    });
    return {
      status: res.status,
      body,
      finalUrl: res.url,
      headers,
    };
  }
}
