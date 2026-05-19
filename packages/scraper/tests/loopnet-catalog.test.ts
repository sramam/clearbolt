import { describe, expect, it } from "vitest";
import {
  LOOPNET_CALIFORNIA_CATALOG_URL,
  discoverListingRefsFromLoopNetCatalogPage,
  discoverNextLoopNetCatalogPageUrl,
  isLoopNetCatalogUrl,
  listingRefFromLoopNetUrl,
} from "../src/adapters/loopnet-catalog.js";

const SAMPLE_CATALOG_HTML = `
  <nav class="pagination">
    <a rel="next" href="/biz/california-businesses-for-sale/2/">Next</a>
    <a href="/biz/california-businesses-for-sale/3/">3</a>
  </nav>
  <a href="https://www.loopnet.com/Listing/Coffee-Shop-Los-Angeles-CA/32628102/">Coffee Shop</a>
  <a href="/Listing/Auto-Repair-San-Diego-CA/32569174/">Auto Repair</a>
`;

/**
 * Real-world snapshot from the current Angular `/biz/` SPA. Listings are SSR'd
 * with `/biz/business-opportunity/{slug}/{id}/` anchors, and the pager emits a
 * double-slash variant (`…/california-businesses-for-sale//2/`).
 */
const SAMPLE_ANGULAR_CATALOG_HTML = `
  <app-listings-container>
    <app-listing-diamond>
      <a class="pointer" title="Little Italy Restaurant"
         href="/biz/business-opportunity/little-italy-restaurant/2484192/">x</a>
    </app-listing-diamond>
    <app-listing-diamond>
      <a class="pointer" title="Mexican Food Drive Through Restaurant For Sale"
         href="/biz/business-opportunity/mexican-food-drive-through-restaurant-for-sale/2483523/">x</a>
    </app-listing-diamond>
  </app-listings-container>
  <ul class="ngx-pagination">
    <li><a title="Page 2" href="/biz/california-businesses-for-sale//2/"><span>2</span></a></li>
    <li><a title="Page 159" href="/biz/california-businesses-for-sale//159/"><span>159</span></a></li>
  </ul>
`;

describe("loopnet catalog", () => {
  it("recognizes california businesses-for-sale catalog URL", () => {
    expect(isLoopNetCatalogUrl(LOOPNET_CALIFORNIA_CATALOG_URL)).toBe(true);
    expect(
      isLoopNetCatalogUrl(
        "https://www.loopnet.com/biz/california-united-states/businesses-for-sale/",
      ),
    ).toBe(true);
    expect(
      isLoopNetCatalogUrl(
        "https://www.loopnet.com/biz/denver-county-co/laundromats-and-coin-laundry-businesses",
      ),
    ).toBe(true);
    expect(
      isLoopNetCatalogUrl(
        "https://www.loopnet.com/biz/georgia-united-states/atlanta-businesses-for-sale/4",
      ),
    ).toBe(true);
    expect(
      isLoopNetCatalogUrl("https://www.loopnet.com/Listing/Some-Biz/123/"),
    ).toBe(false);
    expect(
      isLoopNetCatalogUrl(
        "https://www.loopnet.com/search/commercial-real-estate/denver-co/for-sale/",
      ),
    ).toBe(false);
  });

  it("parses listing refs from catalog HTML", async () => {
    const refs = await discoverListingRefsFromLoopNetCatalogPage(
      SAMPLE_CATALOG_HTML,
      LOOPNET_CALIFORNIA_CATALOG_URL,
    );
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.externalId).sort()).toEqual([
      "32569174",
      "32628102",
    ]);
    expect(refs[0]?.url).toContain("www.loopnet.com/Listing/");
  });

  it("discovers next page via path pagination", () => {
    const next = discoverNextLoopNetCatalogPageUrl(
      SAMPLE_CATALOG_HTML,
      LOOPNET_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toBe(
      "https://www.loopnet.com/biz/california-businesses-for-sale/2/",
    );
    const fromPage2 = discoverNextLoopNetCatalogPageUrl(
      SAMPLE_CATALOG_HTML,
      "https://www.loopnet.com/biz/california-businesses-for-sale/2/",
    );
    expect(fromPage2).toBe(
      "https://www.loopnet.com/biz/california-businesses-for-sale/3/",
    );
  });

  it("normalizes listing URLs with numeric external ids", () => {
    const ref = listingRefFromLoopNetUrl(
      "https://loopnet.com/Listing/1750-W-Mississippi-Ave-Denver-CO/32628102",
    );
    expect(ref?.externalId).toBe("32628102");
    expect(ref?.url).toBe(
      "https://www.loopnet.com/Listing/1750-W-Mississippi-Ave-Denver-CO/32628102",
    );
  });

  it("parses listing refs from the Angular /biz/ SPA shape", async () => {
    const refs = await discoverListingRefsFromLoopNetCatalogPage(
      SAMPLE_ANGULAR_CATALOG_HTML,
      LOOPNET_CALIFORNIA_CATALOG_URL,
    );
    expect(refs.map((r) => r.externalId).sort()).toEqual([
      "2483523",
      "2484192",
    ]);
    for (const r of refs) {
      expect(r.url).toContain("www.loopnet.com/biz/business-opportunity/");
    }
  });

  it("recognizes the double-slash Angular pager URL as a catalog page", () => {
    expect(
      isLoopNetCatalogUrl(
        "https://www.loopnet.com/biz/california-businesses-for-sale//2/",
      ),
    ).toBe(true);
  });

  it("discovers next page from the Angular /biz/ SPA pager", () => {
    const next = discoverNextLoopNetCatalogPageUrl(
      SAMPLE_ANGULAR_CATALOG_HTML,
      LOOPNET_CALIFORNIA_CATALOG_URL,
    );
    /** Canonicalize back to the single-slash form regardless of input. */
    expect(next).toBe(
      "https://www.loopnet.com/biz/california-businesses-for-sale/2/",
    );
  });

  it("recognizes /biz/business-opportunity/{slug}/{id}/ as a listing URL", () => {
    const ref = listingRefFromLoopNetUrl(
      "https://www.loopnet.com/biz/business-opportunity/little-italy-restaurant/2484192/",
    );
    expect(ref?.externalId).toBe("2484192");
    expect(ref?.url).toBe(
      "https://www.loopnet.com/biz/business-opportunity/little-italy-restaurant/2484192/",
    );
  });
});
