import { describe, expect, it } from "vitest";
import {
  discoverNextBizBuySellCatalogPageUrl,
  recoverCatalogPageUrl,
} from "../../src/adapters/bizbuysell/catalog.js";
import { discoverNextPageUrl } from "../../src/discovery/pagination/discover-next.js";
import {
  pathIncrementStrategy,
  queryPageStrategy,
  relNextStrategy,
} from "../../src/discovery/pagination/strategies.js";

const CALIFORNIA_CATALOG =
  "https://www.bizbuysell.com/california-businesses-for-sale/";

describe("discovery/pagination", () => {
  it("rel-next strategy follows link rel=next", () => {
    const html = `<link rel="next" href="/foo?page=2">`;
    const next = discoverNextPageUrl(html, "https://example.com/foo?page=1", [
      relNextStrategy,
    ]);
    expect(next).toBe("https://example.com/foo?page=2");
  });

  it("query-page strategy increments ?page=", () => {
    const html = `<a href="?page=2">2</a><a href="?page=3">3</a>`;
    const next = discoverNextPageUrl(
      html,
      "https://example.com/search?page=1",
      [queryPageStrategy],
    );
    expect(next).toBe("https://example.com/search?page=2");
  });

  it("path-increment strategy finds /slug/N/ links", () => {
    const strategy = pathIncrementStrategy({
      catalogPathPattern: /-for-sale(?:\/\d+)?\/?$/i,
      pageFromPathname: (p) => {
        const m = p.match(/-for-sale\/(\d+)\/?$/i);
        return m?.[1] ? Number.parseInt(m[1], 10) : 1;
      },
      pageFromLinkPathname: (p) => {
        const m = p.match(/-for-sale\/(\d+)\/?$/i);
        return m?.[1] ? Number.parseInt(m[1], 10) : null;
      },
      buildPageUrl: (base, n) => {
        const slug = base.pathname.replace(/\/\d+\/?$/, "").replace(/\/$/, "");
        const u = new URL(base);
        u.pathname = n <= 1 ? `${slug}/` : `${slug}/${n}/`;
        return u.toString();
      },
    });
    const html = `
      <a href="/california-for-sale/1/">1</a>
      <a href="/california-for-sale/2/">2</a>
    `;
    const next = discoverNextPageUrl(
      html,
      CALIFORNIA_CATALOG.replace("businesses-for-sale", "for-sale"),
      [strategy],
    );
    expect(next).toContain("/california-for-sale/2/");
  });
});

describe("bizbuysell catalog pagination", () => {
  it("discovers next page from path links (ngx pagination)", () => {
    const html = `
      <div class="pagination">
        <a href="/california-businesses-for-sale/1/">1</a>
        <a href="/california-businesses-for-sale/2/">2</a>
        <a href="/california-businesses-for-sale/3/">3</a>
        <a class="bbsPager_next">Next</a>
      </div>
    `;
    expect(discoverNextBizBuySellCatalogPageUrl(html, CALIFORNIA_CATALOG)).toBe(
      "https://www.bizbuysell.com/california-businesses-for-sale/2/",
    );
    expect(
      discoverNextBizBuySellCatalogPageUrl(
        html,
        "https://www.bizbuysell.com/california-businesses-for-sale/2/",
      ),
    ).toBe("https://www.bizbuysell.com/california-businesses-for-sale/3/");
  });

  it("advances when fetch finalUrl is mobile home but page had listings", () => {
    const html = `
      <a href="/california-businesses-for-sale/46/">46</a>
      <a href="https://www.bizbuysell.com/business-opportunity/sample/1111001/">x</a>
    `;
    expect(
      discoverNextBizBuySellCatalogPageUrl(html, "https://m.bizbuysell.com/", {
        catalogBaseUrl: CALIFORNIA_CATALOG,
        currentPageNumber: 45,
      }),
    ).toBe("https://www.bizbuysell.com/california-businesses-for-sale/46/");
  });

  it("recoverCatalogPageUrl rebuilds path pagination", () => {
    expect(recoverCatalogPageUrl(CALIFORNIA_CATALOG, 45)).toBe(
      "https://www.bizbuysell.com/california-businesses-for-sale/45/",
    );
  });
});
