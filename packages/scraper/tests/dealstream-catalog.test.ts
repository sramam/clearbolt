import { describe, expect, it } from "vitest";
import {
  DEALSTREAM_CALIFORNIA_CATALOG_URL,
  discoverListingRefsFromDealStreamCatalogPage,
  discoverNextDealStreamCatalogPageUrl,
  isDealStreamCatalogUrl,
  listingRefFromDealStreamUrl,
} from "../src/adapters/dealstream-catalog.js";

const SAMPLE_CATALOG_HTML = `
  <div class="pagination">
    <a href="/california-businesses-for-sale/">1</a>
    <a href="/california-businesses-for-sale/2">2</a>
    <a rel="next" href="/california-businesses-for-sale/2">Next</a>
  </div>
  <a href="https://dealstream.com/d/biz-sale/hvac/9m25ky">HVAC Deal A</a>
  <a href="/d/biz-sale/medical-labs/s92cvu">Lab Deal B</a>
`;

describe("dealstream catalog", () => {
  it("recognizes california catalog URL", () => {
    expect(isDealStreamCatalogUrl(DEALSTREAM_CALIFORNIA_CATALOG_URL)).toBe(
      true,
    );
    expect(isDealStreamCatalogUrl("https://dealstream.com/biz-sale/167")).toBe(
      true,
    );
    expect(
      isDealStreamCatalogUrl("https://dealstream.com/d/biz-sale/hvac/9m25ky"),
    ).toBe(false);
  });

  it("parses listing refs from catalog HTML", async () => {
    const refs = await discoverListingRefsFromDealStreamCatalogPage(
      SAMPLE_CATALOG_HTML,
      DEALSTREAM_CALIFORNIA_CATALOG_URL,
    );
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.externalId).sort()).toEqual(["9m25ky", "s92cvu"]);
  });

  it("discovers next page via path pagination", () => {
    const next = discoverNextDealStreamCatalogPageUrl(
      SAMPLE_CATALOG_HTML,
      DEALSTREAM_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toBe(
      "https://dealstream.com/california-businesses-for-sale/2/",
    );
  });

  it("normalizes listing URLs with slug external ids", () => {
    const ref = listingRefFromDealStreamUrl(
      "https://dealstream.com/d/biz-sale/hvac/kqnz5k",
    );
    expect(ref?.externalId).toBe("kqnz5k");
    expect(ref?.url).toBe("https://dealstream.com/d/biz-sale/hvac/kqnz5k");
  });
});
