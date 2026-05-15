import type { FetchRequest, RawResponse } from "@clearbolt/core";
import { describe, expect, it } from "vitest";
import { fetchHtmlWithHttpWafPolicy } from "../src/fetch-with-waf-policy.js";
import type { Fetcher } from "../src/fetcher.js";

class SequencedFetcher implements Fetcher {
  private i = 0;
  constructor(private readonly responses: RawResponse[]) {}

  async fetch(req: FetchRequest): Promise<RawResponse> {
    const r = this.responses[this.i++];
    if (!r) {
      return { status: 404, body: "", finalUrl: req.url, headers: {} };
    }
    return { ...r, finalUrl: r.finalUrl || req.url };
  }
}

const url = "https://www.bizbuysell.com/california-business-for-sale/1234567/";
const fastRetry = { throttleMsBetweenRetries: 0 };

class NeverFetch implements Fetcher {
  async fetch(): Promise<RawResponse> {
    throw new Error("fetch should not run when hostRequiresBrowser");
  }
}

describe("fetchHtmlWithHttpWafPolicy", () => {
  it("returns_first_ok_response", async () => {
    const fetcher = new SequencedFetcher([
      { status: 200, body: "<html>ok</html>", finalUrl: url, headers: {} },
    ]);
    const persisted: string[] = [];
    const res = await fetchHtmlWithHttpWafPolicy(fetcher, url, {
      persistNeedsBrowser: async (h) => {
        persisted.push(h);
      },
      ...fastRetry,
    });
    expect(res.status).toBe(200);
    expect(persisted).toEqual([]);
  });

  it("retries_rate_limit_then_succeeds", async () => {
    const fetcher = new SequencedFetcher([
      { status: 429, body: "slow down", finalUrl: url, headers: {} },
      { status: 429, body: "slow down", finalUrl: url, headers: {} },
      { status: 200, body: "<html>ok</html>", finalUrl: url, headers: {} },
    ]);
    const persisted: string[] = [];
    const res = await fetchHtmlWithHttpWafPolicy(fetcher, url, {
      persistNeedsBrowser: async (h) => {
        persisted.push(h);
      },
      ...fastRetry,
    });
    expect(res.body).toContain("ok");
    expect(persisted).toEqual([]);
  });

  it("persists_needs_browser_after_max_rate_limited_attempts", async () => {
    const fetcher = new SequencedFetcher([
      { status: 429, body: "a", finalUrl: url, headers: {} },
      { status: 429, body: "b", finalUrl: url, headers: {} },
      { status: 429, body: "c", finalUrl: url, headers: {} },
    ]);
    const persisted: string[] = [];
    await expect(
      fetchHtmlWithHttpWafPolicy(fetcher, url, {
        persistNeedsBrowser: async (h) => {
          persisted.push(h);
        },
        maxHttpAttempts: 3,
        ...fastRetry,
      }),
    ).rejects.toThrow(/needsBrowser=true stored/);
    expect(persisted).toEqual(["www.bizbuysell.com"]);
  });

  it("throws_before_fetch_when_host_requires_browser", async () => {
    const fetcher = new NeverFetch();
    await expect(
      fetchHtmlWithHttpWafPolicy(fetcher, url, {
        persistNeedsBrowser: async () => {},
        hostRequiresBrowser: async () => true,
        ...fastRetry,
      }),
    ).rejects.toThrow(/browser lane \(needsBrowser\)/);
  });

  it("persists_on_challenge_without_extra_http_retries", async () => {
    const fetcher = new SequencedFetcher([
      { status: 403, body: "forbidden", finalUrl: url, headers: {} },
    ]);
    const persisted: string[] = [];
    await expect(
      fetchHtmlWithHttpWafPolicy(fetcher, url, {
        persistNeedsBrowser: async (h) => {
          persisted.push(h);
        },
        ...fastRetry,
      }),
    ).rejects.toThrow(/WAF challenge/);
    expect(persisted).toEqual(["www.bizbuysell.com"]);
  });
});
