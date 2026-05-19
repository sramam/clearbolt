import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BIZBUYSELL_CALIFORNIA_CATALOG_URL,
  discoverListingRefsFromCatalogPage,
  discoverNextCatalogPageUrl,
  isBizBuySellCatalogUrl,
} from "../src/adapters/bizbuysell-catalog.js";
import { rewriteBizBuySellToMobileUrl } from "../src/adapters/bizbuysell-mobile.js";
import { catalogAdapterFromUrl } from "../src/catalog-adapter-from-url.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("bizbuysell catalog", () => {
  it("recognizes california catalog URL", () => {
    expect(isBizBuySellCatalogUrl(BIZBUYSELL_CALIFORNIA_CATALOG_URL)).toBe(
      true,
    );
    expect(
      isBizBuySellCatalogUrl(
        "https://www.bizbuysell.com/california-businesses-for-sale/2/",
      ),
    ).toBe(true);
    expect(
      isBizBuySellCatalogUrl(
        "https://www.bizbuysell.com/businesses-for-sale/?q=pool",
      ),
    ).toBe(false);
  });

  it("recognizes nationwide catalog URL without search params", () => {
    expect(
      isBizBuySellCatalogUrl("https://www.bizbuysell.com/businesses-for-sale/"),
    ).toBe(true);
    expect(
      isBizBuySellCatalogUrl(
        "https://www.bizbuysell.com/businesses-for-sale/2/",
      ),
    ).toBe(true);
    expect(
      catalogAdapterFromUrl("https://www.bizbuysell.com/businesses-for-sale/"),
    ).toBe("bizbuysell");
  });

  it("rewrites to mobile host", () => {
    expect(
      rewriteBizBuySellToMobileUrl(BIZBUYSELL_CALIFORNIA_CATALOG_URL),
    ).toBe("https://m.bizbuysell.com/california-businesses-for-sale/");
  });

  it("synthesizes next page when pager chrome exists without page links", () => {
    const html = `
      <div class="ngx-pagination">
        <a class="bbsPager_next">Next</a>
      </div>
      <a href="/business-opportunity/foo/1234567/">listing</a>
    `;
    const next = discoverNextCatalogPageUrl(
      html,
      BIZBUYSELL_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toBe(
      "https://www.bizbuysell.com/california-businesses-for-sale/2/",
    );
  });

  it("synthesizes next page when only a high page link is in HTML", () => {
    const html = `<a href="/california-businesses-for-sale/120/">120</a>`;
    const next = discoverNextCatalogPageUrl(
      html,
      BIZBUYSELL_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toBe(
      "https://www.bizbuysell.com/california-businesses-for-sale/2/",
    );
  });

  it("advances past spurious page-1 link when already on catalog page 1", () => {
    const html = `
      <div class="ngx-pagination">
        <a href="/california-businesses-for-sale/1/">1</a>
        <a class="bbsPager_next">Next</a>
      </div>
      <a href="/business-opportunity/foo/1234567/">listing</a>
    `;
    const next = discoverNextCatalogPageUrl(
      html,
      BIZBUYSELL_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toBe(
      "https://www.bizbuysell.com/california-businesses-for-sale/2/",
    );
  });

  it("discovers next page from BBS path pagination", () => {
    const html = `
      <div class="pagination">
        <a href="/california-businesses-for-sale/1/">1</a>
        <a href="/california-businesses-for-sale/2/">2</a>
        <a href="/california-businesses-for-sale/3/">3</a>
        <a class="bbsPager_next">Next</a>
      </div>
    `;
    const next = discoverNextCatalogPageUrl(
      html,
      BIZBUYSELL_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toBe(
      "https://www.bizbuysell.com/california-businesses-for-sale/2/",
    );
    const fromPage2 = discoverNextCatalogPageUrl(
      html,
      "https://www.bizbuysell.com/california-businesses-for-sale/2/",
    );
    expect(fromPage2).toBe(
      "https://www.bizbuysell.com/california-businesses-for-sale/3/",
    );
  });

  it("discovers next page from rel=next", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizbuysell-catalog-page-1.html"),
      "utf8",
    );
    const next = discoverNextCatalogPageUrl(
      html,
      BIZBUYSELL_CALIFORNIA_CATALOG_URL,
    );
    expect(next).toContain("page=2");
  });

  it("discovers listings across paginated fixtures", async () => {
    const page1 = await readFile(
      join(__dirname, "fixtures", "bizbuysell-catalog-page-1.html"),
      "utf8",
    );
    const page2 = await readFile(
      join(__dirname, "fixtures", "bizbuysell-catalog-page-2.html"),
      "utf8",
    );
    const refs1 = await discoverListingRefsFromCatalogPage(
      page1,
      BIZBUYSELL_CALIFORNIA_CATALOG_URL,
    );
    const refs2 = await discoverListingRefsFromCatalogPage(
      page2,
      "https://www.bizbuysell.com/california-businesses-for-sale/?page=2",
    );
    const ids = new Set(
      [...refs1, ...refs2].map((r) => r.externalId).filter(Boolean),
    );
    expect(ids.size).toBe(3);
    expect(ids.has("1111001")).toBe(true);
    expect(ids.has("1111003")).toBe(true);
  });
});
