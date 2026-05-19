import { describe, expect, it } from "vitest";
import {
  formatCatalogPageDuration,
  walkCatalogPages,
} from "../../src/discovery/catalog-walk.js";
import { mergeListingRefByExternalId } from "../../src/discovery/listing-ref-merge.js";

describe("formatCatalogPageDuration", () => {
  it("formats sub-second and longer durations", () => {
    expect(formatCatalogPageDuration(450)).toBe("450ms");
    expect(formatCatalogPageDuration(2500)).toBe("2.5s");
    expect(formatCatalogPageDuration(125_000)).toBe("2m 5s");
  });
});

describe("walkCatalogPages", () => {
  it("includes per-page timing in progress messages", async () => {
    const messages: string[] = [];
    await walkCatalogPages({
      startUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
      maxPages: 1,
      maxListings: 0,
      onProgress: (p) => messages.push(p.message),
      fetchPage: async () => ({
        body: `<a href="https://www.bizbuysell.com/business-opportunity/x/1111001/">x</a>`,
        finalUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
      }),
      discoverRefs: async () => [
        {
          url: "https://www.bizbuysell.com/business-opportunity/x/1111001/",
          externalId: "1111001",
        },
      ],
      discoverNext: () => null,
      catalogBaseUrl:
        "https://www.bizbuysell.com/california-businesses-for-sale/",
    });
    expect(
      messages.some((m) =>
        /Page 1:.* in \d/.test(m) && /\(fetch .+, parse .+\)/.test(m),
      ),
    ).toBe(true);
  });

  it("dedupes the same listing across pages by external id", async () => {
    const pages = [
      `<a href="https://m.bizbuysell.com/business-opportunity/a/1111001/">a</a>`,
      `<a href="https://www.bizbuysell.com/business-opportunity/a/1111001/">a</a>`,
    ];
    let pageIndex = 0;
    const result = await walkCatalogPages({
      startUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
      maxPages: 2,
      maxListings: 0,
      mergeRef: mergeListingRefByExternalId,
      fetchPage: async () => {
        const body = pages[pageIndex] ?? "";
        pageIndex++;
        return {
          body,
          finalUrl:
            "https://www.bizbuysell.com/california-businesses-for-sale/",
        };
      },
      discoverRefs: async (html) => {
        const m = html.match(/href="([^"]+)"/);
        if (!m?.[1]) return [];
        return [{ url: m[1], externalId: "1111001" }];
      },
      discoverNext: (_html, _url, pageNumber) =>
        pageNumber < 2
          ? "https://www.bizbuysell.com/california-businesses-for-sale/2/"
          : null,
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0]?.externalId).toBe("1111001");
    expect(result.refs[0]?.url).toContain("www.bizbuysell.com");
  });

  it("walks until no next page when maxPages is 0", async () => {
    let page = 0;
    const result = await walkCatalogPages({
      startUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
      maxPages: 0,
      maxListings: 0,
      fetchPage: async () => {
        page++;
        const listingId = `${page}111001`;
        return {
          body: `<a href="https://www.bizbuysell.com/business-opportunity/x/${listingId}/">x</a>`,
          finalUrl: `https://www.bizbuysell.com/california-businesses-for-sale/${page}/`,
        };
      },
      discoverRefs: async (html) => {
        const m = html.match(/business-opportunity\/x\/(\d{6,})\//);
        return m
          ? [
              {
                url: `https://www.bizbuysell.com/business-opportunity/x/${m[1]}/`,
                externalId: m[1],
              },
            ]
          : [];
      },
      discoverNext: (_html, url, pageNumber) => {
        const n = Number(url.match(/\/(\d+)\/$/)?.[1] ?? String(pageNumber));
        return n < 3
          ? `https://www.bizbuysell.com/california-businesses-for-sale/${n + 1}/`
          : null;
      },
    });
    expect(result.pagesFetched).toBe(3);
    expect(result.refs).toHaveLength(3);
  });

  it("continues pagination when finalUrl drifts to mobile home", async () => {
    let page = 0;
    const result = await walkCatalogPages({
      startUrl: "https://m.bizbuysell.com/california-businesses-for-sale/",
      catalogBaseUrl:
        "https://www.bizbuysell.com/california-businesses-for-sale/",
      maxPages: 0,
      maxListings: 0,
      fetchPage: async () => {
        page++;
        return {
          body: `<a href="https://www.bizbuysell.com/business-opportunity/x/${page}111001/">x</a>`,
          finalUrl: "https://m.bizbuysell.com/",
        };
      },
      discoverRefs: async (html) => {
        const m = html.match(/business-opportunity\/x\/(\d{6,})\//);
        return m
          ? [
              {
                url: `https://www.bizbuysell.com/business-opportunity/x/${m[1]}/`,
                externalId: m[1],
              },
            ]
          : [];
      },
      discoverNext: (html, _url, pageNumber) =>
        pageNumber < 2
          ? `https://www.bizbuysell.com/california-businesses-for-sale/${pageNumber + 1}/`
          : null,
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.refs).toHaveLength(2);
  });
});
