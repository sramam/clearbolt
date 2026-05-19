import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchListingHtmlWithWafPolicy } from "../src/adapters/bizbuysell.js";
import { shouldRetryBizBuySellListingOnDesktop } from "../src/bizbuysell-run-policy.js";
import { hardAkamaiDenialMessage } from "../src/waf-retry-policy.js";

vi.mock("../src/fetch-with-waf-policy.js", () => ({
  fetchHtmlWithHttpWafPolicy: vi.fn(),
}));

import { fetchHtmlWithHttpWafPolicy } from "../src/fetch-with-waf-policy.js";

const LISTING_WWW =
  "https://www.bizbuysell.com/business-opportunity/reduced-san-diegos-1-video-game-bus-mobile-party-business/2383708/";
const LISTING_M =
  "https://m.bizbuysell.com/business-opportunity/reduced-san-diegos-1-video-game-bus-mobile-party-business/2383708/";

describe("shouldRetryBizBuySellListingOnDesktop", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("returns true for Akamai hard block errors", () => {
    expect(
      shouldRetryBizBuySellListingOnDesktop(
        new Error(hardAkamaiDenialMessage(LISTING_M)),
      ),
    ).toBe(true);
  });

  it("returns false when LISTING_DESKTOP_FALLBACK=0", () => {
    process.env.CLEARBOLT_BIZBUYSELL_LISTING_DESKTOP_FALLBACK = "0";
    expect(
      shouldRetryBizBuySellListingOnDesktop(
        new Error(hardAkamaiDenialMessage(LISTING_M)),
      ),
    ).toBe(false);
  });
});

describe("fetchListingHtmlWithWafPolicy www fallback", () => {
  const env = process.env;
  const mockFetch = vi.mocked(fetchHtmlWithHttpWafPolicy);

  afterEach(() => {
    process.env = env;
    mockFetch.mockReset();
  });

  it("retries www when m. returns Akamai hard block", async () => {
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = "1";
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = "proxy-endpoints.local.txt";

    mockFetch
      .mockRejectedValueOnce(new Error(hardAkamaiDenialMessage(LISTING_M)))
      .mockResolvedValueOnce({
        status: 200,
        body: "<html><body>listing ok</body></html>",
        finalUrl: LISTING_WWW,
        headers: {},
      });

    const fetcher = { fetch: vi.fn() };
    const result = await fetchListingHtmlWithWafPolicy(
      fetcher,
      { url: LISTING_WWW, externalId: "2383708" },
      {
        persistNeedsBrowser: async () => undefined,
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0]?.[1]).toBe(LISTING_M);
    expect(mockFetch.mock.calls[1]?.[1]).toBe(LISTING_WWW);
    expect(result.finalUrl).toBe(LISTING_WWW);
    expect(result.html).toContain("listing ok");
  });

  it("tries www first when desktopFirst is set", async () => {
    process.env.CLEARBOLT_BIZBUYSELL_LISTING_PREFER_MOBILE = "0";
    mockFetch.mockResolvedValueOnce({
      status: 200,
      body: "<html>ok</html>",
      finalUrl: LISTING_WWW,
      headers: {},
    });
    const fetcher = { fetch: vi.fn() };
    await fetchListingHtmlWithWafPolicy(
      fetcher,
      { url: LISTING_WWW, externalId: "2383708" },
      { persistNeedsBrowser: async () => undefined, desktopFirst: true },
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[1]).toBe(LISTING_WWW);
  });
});
