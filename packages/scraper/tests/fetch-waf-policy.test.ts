import type { FetchRequest, RawResponse } from "@clearbolt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearProxyHostEscalations } from "../src/proxy-config.js";
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
const fastRetry = { throttleMsBetweenRetries: 0, crawlGate: false as const };

/** Browser-lane success body (passes thin-HTML + catalog heuristics). */
function browserLaneOkBody(inner: string): string {
  return `<html>${inner} business-opportunity/1234567/ ${"x".repeat(6000)}</html>`;
}

class NeverFetch implements Fetcher {
  async fetch(): Promise<RawResponse> {
    throw new Error("fetch should not run when hostRequiresBrowser");
  }
}

describe("fetchHtmlWithHttpWafPolicy", () => {
  const env = process.env;

  beforeEach(() => {
    delete process.env.CLEARBOLT_PROXY_POLICY;
    delete process.env.CLEARBOLT_PROXY_RESIDENTIAL;
    delete process.env.CLEARBOLT_PROXY_DATACENTER;
    clearProxyHostEscalations();
  });

  afterEach(() => {
    process.env = env;
    clearProxyHostEscalations();
  });

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

  it("persists_needs_browser_after_max_rate_limited_attempts_then_browser", async () => {
    const http = new SequencedFetcher([
      { status: 429, body: "a", finalUrl: url, headers: {} },
      { status: 429, body: "b", finalUrl: url, headers: {} },
      { status: 429, body: "c", finalUrl: url, headers: {} },
    ]);
    const browser = new SequencedFetcher([
      {
        status: 200,
        body: browserLaneOkBody("browser-lane"),
        finalUrl: url,
        headers: {},
      },
    ]);
    const persisted: string[] = [];
    const res = await fetchHtmlWithHttpWafPolicy(http, url, {
      persistNeedsBrowser: async (h) => {
        persisted.push(h);
      },
      maxHttpAttempts: 3,
      browserFetcher: browser,
      ...fastRetry,
    });
    expect(res.body).toContain("browser-lane");
    expect(persisted).toEqual(["www.bizbuysell.com"]);
  });

  it("throws_after_max_rate_limited_when_no_browser_fetcher", async () => {
    const http = new SequencedFetcher([
      { status: 429, body: "a", finalUrl: url, headers: {} },
      { status: 429, body: "b", finalUrl: url, headers: {} },
      { status: 429, body: "c", finalUrl: url, headers: {} },
    ]);
    const persisted: string[] = [];
    await expect(
      fetchHtmlWithHttpWafPolicy(http, url, {
        persistNeedsBrowser: async (h) => {
          persisted.push(h);
        },
        maxHttpAttempts: 3,
        ...fastRetry,
      }),
    ).rejects.toThrow(/needsBrowser=true stored/);
    expect(persisted).toEqual(["www.bizbuysell.com"]);
  });

  it("uses_browser_when_host_requires_browser_without_http_fetch", async () => {
    const http = new NeverFetch();
    const browser = new SequencedFetcher([
      {
        status: 200,
        body: "<html>browser-only</html>",
        finalUrl: url,
        headers: {},
      },
    ]);
    const res = await fetchHtmlWithHttpWafPolicy(http, url, {
      persistNeedsBrowser: async () => {},
      hostRequiresBrowser: async () => true,
      browserFetcher: browser,
      ...fastRetry,
    });
    expect(res.body).toContain("browser-only");
  });

  it("throws_when_host_requires_browser_but_no_browser_fetcher", async () => {
    const http = new NeverFetch();
    await expect(
      fetchHtmlWithHttpWafPolicy(http, url, {
        persistNeedsBrowser: async () => {},
        hostRequiresBrowser: async () => true,
        ...fastRetry,
      }),
    ).rejects.toThrow(/requires the browser lane/);
  });

  it("retries_on_browser_lane_when_primary", async () => {
    const browser = new SequencedFetcher([
      { status: 403, body: "akamai challenge tiny", finalUrl: url, headers: {} },
      {
        status: 200,
        body: `<html>${"x".repeat(6000)}</html>`,
        finalUrl: url,
        headers: {},
      },
    ]);
    const res = await fetchHtmlWithHttpWafPolicy(browser, url, {
      persistNeedsBrowser: async () => {},
      browserLanePrimary: true,
      wafMinHtmlChars: 5000,
      ...fastRetry,
    });
    expect(res.body.length).toBeGreaterThan(5000);
  });

  it("retries_http_after_residential_escalation_before_browser", async () => {
    process.env.CLEARBOLT_PROXY_POLICY = "direct-then-residential";
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://u:p@res.example:8080";
    const http = new SequencedFetcher([
      { status: 403, body: "forbidden", finalUrl: url, headers: {} },
      {
        status: 200,
        body: "<html>ok-via-residential-http</html>",
        finalUrl: url,
        headers: {},
      },
    ]);
    const browser = new NeverFetch();
    const persisted: string[] = [];
    const res = await fetchHtmlWithHttpWafPolicy(http, url, {
      persistNeedsBrowser: async (h) => {
        persisted.push(h);
      },
      browserFetcher: browser,
      ...fastRetry,
    });
    expect(res.body).toContain("ok-via-residential-http");
    expect(persisted).toEqual([]);
  });

  it("persists_on_challenge_then_browser_when_configured", async () => {
    const http = new SequencedFetcher([
      { status: 403, body: "forbidden", finalUrl: url, headers: {} },
    ]);
    const browser = new SequencedFetcher([
      {
        status: 200,
        body: browserLaneOkBody("via-browser"),
        finalUrl: url,
        headers: {},
      },
    ]);
    const persisted: string[] = [];
    const res = await fetchHtmlWithHttpWafPolicy(http, url, {
      persistNeedsBrowser: async (h) => {
        persisted.push(h);
      },
      browserFetcher: browser,
      ...fastRetry,
    });
    expect(res.body).toContain("via-browser");
    expect(persisted).toEqual(["www.bizbuysell.com"]);
  });

  it("hard_akamai_denial_skips_browser_escalation", async () => {
    const accessDenied = `<html>Access Denied
You don't have permission to access
Reference #18.abc
https://errors.edgesuite.net/18.abc</html>`;
    const http = new SequencedFetcher([
      { status: 403, body: accessDenied, finalUrl: url, headers: {} },
    ]);
    let browserFetches = 0;
    const browser: Fetcher = {
      fetch: async () => {
        browserFetches++;
        return {
          status: 200,
          body: browserLaneOkBody("should-not-run"),
          finalUrl: url,
          headers: {},
        };
      },
    };
    await expect(
      fetchHtmlWithHttpWafPolicy(http, url, {
        persistNeedsBrowser: async () => {},
        browserFetcher: browser,
        maxHttpAttempts: 3,
        ...fastRetry,
      }),
    ).rejects.toThrow(/Akamai hard block \(not retriable/);
    expect(browserFetches).toBe(0);
  });

  it("persists_on_challenge_without_browser_still_throws", async () => {
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
