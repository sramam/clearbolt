import { describe, expect, it } from "vitest";
import {
  BUSINESSBROKER_CALIFORNIA_CATALOG_URL,
  discoverListingRefsFromBusinessBrokerCatalogPage,
  discoverNextBusinessBrokerCatalogPageUrl,
  isBusinessBrokerCatalogUrl,
  listingRefFromBusinessBrokerUrl,
} from "../src/adapters/businessbroker-catalog.js";

const SAMPLE_CATALOG_HTML = `
  <div class="pagination">
    <a href="/state/california-businesses-for-sale.aspx?page=1">1</a>
    <a href="/state/california-businesses-for-sale.aspx?page=2">2</a>
    <a href="/state/california-businesses-for-sale.aspx?page=3">3</a>
    <a class="pagination-next" href="/state/california-businesses-for-sale.aspx?page=2">Next</a>
  </div>
  <a href="/business-for-sale/sample-listing-one-california/1010506.aspx">Listing A</a>
  <a href="/business-for-sale/sample-listing-two-california/1008299.aspx">Listing B</a>
`;

describe("businessbroker catalog", () => {
  it("recognizes california catalog URL", () => {
    expect(
      isBusinessBrokerCatalogUrl(BUSINESSBROKER_CALIFORNIA_CATALOG_URL),
    ).toBe(true);
    expect(
      isBusinessBrokerCatalogUrl(
        "https://www.businessbroker.net/industry/food-fast-food-businesses-for-sale.aspx?page=2",
      ),
    ).toBe(true);
    expect(
      isBusinessBrokerCatalogUrl(
        "https://www.businessbroker.net/search-businesses-for-sale.aspx",
      ),
    ).toBe(false);
  });

  it("parses listing refs from catalog HTML", async () => {
    const refs = await discoverListingRefsFromBusinessBrokerCatalogPage(
      SAMPLE_CATALOG_HTML,
      BUSINESSBROKER_CALIFORNIA_CATALOG_URL,
    );
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.externalId).sort()).toEqual([
      "1008299",
      "1010506",
    ]);
    expect(refs[0]?.url).toContain("www.businessbroker.net");
  });

  it("discovers next page via query pagination", () => {
    const next = discoverNextBusinessBrokerCatalogPageUrl(
      SAMPLE_CATALOG_HTML,
      BUSINESSBROKER_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toBe(
      "https://www.businessbroker.net/state/california-businesses-for-sale.aspx?page=2",
    );
    const fromPage2 = discoverNextBusinessBrokerCatalogPageUrl(
      SAMPLE_CATALOG_HTML,
      "https://www.businessbroker.net/state/california-businesses-for-sale.aspx?page=2",
    );
    expect(fromPage2).toBe(
      "https://www.businessbroker.net/state/california-businesses-for-sale.aspx?page=3",
    );
  });

  it("normalizes listing URLs with numeric external ids", () => {
    const ref = listingRefFromBusinessBrokerUrl(
      "https://businessbroker.net/business-for-sale/nail-salon-california/998859.aspx",
    );
    expect(ref?.externalId).toBe("998859");
    expect(ref?.url).toBe(
      "https://www.businessbroker.net/business-for-sale/nail-salon-california/998859.aspx",
    );
  });
});
