import { describe, expect, it } from "vitest";
import {
  buildBizBuySellSerperQuery,
  discoverBizBuySellListingRefsFromSerper,
  isBizBuySellListingUrl,
  listingRefFromBizBuySellUrl,
} from "../src/bizbuysell-serper-discovery.js";

describe("bizbuysell serper discovery", () => {
  it("detects listing URLs", () => {
    expect(
      isBizBuySellListingUrl(
        "https://www.bizbuysell.com/california-business-for-sale/1234567/",
      ),
    ).toBe(true);
    expect(
      isBizBuySellListingUrl("https://www.bizbuysell.com/businesses-for-sale/"),
    ).toBe(false);
  });

  it("builds site-scoped serper query for listing detail pages", () => {
    const q = buildBizBuySellSerperQuery("pool services");
    expect(q).toContain("site:bizbuysell.com");
    expect(q).toContain("business-opportunity");
    expect(q).toContain("pool services");
  });

  it("parses organic results from serper", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          organic: [
            {
              link: "https://www.bizbuysell.com/texas-business-for-sale/8888888/",
              title: "Pool Co",
            },
            { link: "https://example.com/not-bbs", title: "Nope" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const { refs, serperQuery } = await discoverBizBuySellListingRefsFromSerper(
      "pool",
      5,
      { apiKey: "test-key", fetchImpl: mockFetch },
    );
    expect(serperQuery).toContain("site:bizbuysell.com");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.externalId).toBe("8888888");
    expect(listingRefFromBizBuySellUrl(refs[0]!.url)?.url).toBe(refs[0]!.url);
  });
});
