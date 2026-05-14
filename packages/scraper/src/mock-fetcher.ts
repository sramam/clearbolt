import type { FetchRequest, RawResponse } from "@clearbolt/core";
import type { Fetcher } from "./fetcher.js";

export class MockFetcher implements Fetcher {
  constructor(private readonly responses: Map<string, RawResponse>) {}

  async fetch(req: FetchRequest): Promise<RawResponse> {
    const hit = this.responses.get(req.url);
    if (hit) return { ...hit, finalUrl: hit.finalUrl || req.url };
    return {
      status: 404,
      body: "",
      finalUrl: req.url,
      headers: {},
    };
  }
}
