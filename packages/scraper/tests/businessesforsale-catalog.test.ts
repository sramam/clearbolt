import { describe, expect, it } from "vitest";
import {
  BUSINESSES_FOR_SALE_CALIFORNIA_CATALOG_URL,
  discoverListingRefsFromBusinessesForSaleCatalogPage,
  discoverNextBusinessesForSaleCatalogPageUrl,
  isBusinessesForSaleCatalogUrl,
} from "../src/adapters/businessesforsale-catalog.js";
import { listingRefFromBusinessesForSaleUrl } from "../src/businessesforsale-listing-url.js";

const SAMPLE_CATALOG_HTML = `
  <link rel="next" href="https://us.businessesforsale.com/us/search/businesses-for-sale-in-california-2">
  <script type="application/ld+json">
  {
    "@type": "ItemList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "item": {
          "@type": "Product",
          "productId": 3955046,
          "url": "https://us.businessesforsale.com/us/clean-juice-franchise-in-agoura-hills-ca.aspx"
        }
      },
      {
        "@type": "ListItem",
        "position": 2,
        "item": {
          "@type": "Product",
          "productId": 3951400,
          "url": "https://us.businessesforsale.com/us/20-equity-offer-in-hospice-intelligence-platform.aspx"
        }
      }
    ]
  }
  </script>
  <a href="https://us.businessesforsale.com/us/clean-juice-franchise-in-agoura-hills-ca.aspx">Clean Juice</a>
`;

describe("businessesforsale catalog", () => {
  it("recognizes california catalog URL", () => {
    expect(
      isBusinessesForSaleCatalogUrl(BUSINESSES_FOR_SALE_CALIFORNIA_CATALOG_URL),
    ).toBe(true);
    expect(
      isBusinessesForSaleCatalogUrl(
        "https://us.businessesforsale.com/us/search/businesses-for-sale-in-california-2",
      ),
    ).toBe(true);
    expect(
      isBusinessesForSaleCatalogUrl(
        "https://us.businessesforsale.com/us/clean-juice-franchise-in-agoura-hills-ca.aspx",
      ),
    ).toBe(false);
    expect(
      isBusinessesForSaleCatalogUrl(
        "https://us.businessesforsale.com/us/search/california?save=1",
      ),
    ).toBe(false);
  });

  it("parses listing refs from catalog JSON-LD", async () => {
    const refs = await discoverListingRefsFromBusinessesForSaleCatalogPage(
      SAMPLE_CATALOG_HTML,
      BUSINESSES_FOR_SALE_CALIFORNIA_CATALOG_URL,
    );
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.externalId).sort()).toEqual([
      "3951400",
      "3955046",
    ]);
  });

  it("discovers next page via rel=next", () => {
    const next = discoverNextBusinessesForSaleCatalogPageUrl(
      SAMPLE_CATALOG_HTML,
      "https://us.businessesforsale.com/us/search/businesses-for-sale-in-california",
    );
    expect(next).toBe(
      "https://us.businessesforsale.com/us/search/businesses-for-sale-in-california-2",
    );
  });

  it("normalizes listing URLs", () => {
    const ref = listingRefFromBusinessesForSaleUrl(
      "https://us.businessesforsale.com/us/clean-juice-franchise-in-agoura-hills-ca.aspx?utm=1",
    );
    expect(ref?.url).toBe(
      "https://us.businessesforsale.com/us/clean-juice-franchise-in-agoura-hills-ca.aspx",
    );
  });
});
