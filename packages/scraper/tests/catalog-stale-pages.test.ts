import { describe, expect, it } from "vitest";
import type { ListingRef } from "@clearbolt/core";
import { walkCatalogPages } from "../src/discovery/catalog-walk.js";
import {
  countListingRefsNewOnPage,
  mergeListingRefByExternalId,
} from "../src/discovery/listing-ref-merge.js";

describe("countListingRefsNewOnPage", () => {
  it("counts refs not yet in merged map", () => {
    const merged = new Map<string, ListingRef>();
    mergeListingRefByExternalId(merged, {
      url: "https://www.bizbuysell.com/x/1/",
      externalId: "1",
    });
    const counts = countListingRefsNewOnPage(
      merged,
      [
        { url: "https://www.bizbuysell.com/x/1/", externalId: "1" },
        { url: "https://www.bizbuysell.com/x/2/", externalId: "2" },
      ],
      { mergeRef: mergeListingRefByExternalId },
    );
    expect(counts).toEqual({ total: 2, newOnPage: 1, seenOnPage: 1 });
  });

  it("treats seed keys as seen", () => {
    const merged = new Map<string, ListingRef>();
    const counts = countListingRefsNewOnPage(
      merged,
      [{ url: "https://www.bizbuysell.com/x/9/", externalId: "9" }],
      {
        mergeRef: mergeListingRefByExternalId,
        seedKnownKeys: new Set(["id:9"]),
      },
    );
    expect(counts.newOnPage).toBe(0);
    expect(counts.seenOnPage).toBe(1);
  });
});

describe("walkCatalogPages stale tail", () => {
  it("stops after two consecutive all-seen pages", async () => {
    const pages: ListingRef[][] = [
      [{ url: "https://www.bizbuysell.com/x/1/", externalId: "1" }],
      [{ url: "https://www.bizbuysell.com/x/1/", externalId: "1" }],
      [{ url: "https://www.bizbuysell.com/x/1/", externalId: "1" }],
      [{ url: "https://www.bizbuysell.com/x/99/", externalId: "99" }],
    ];
    let pageIndex = 0;
    const result = await walkCatalogPages({
      startUrl: "https://example.com/catalog/1/",
      maxPages: 0,
      maxListings: 0,
      stalePagesToStop: 2,
      mergeRef: mergeListingRefByExternalId,
      fetchPage: async () => {
        const body = `<html data-page="${pageIndex}"></html>`;
        return { body, finalUrl: `https://example.com/catalog/${pageIndex + 1}/` };
      },
      discoverRefs: async () => pages[pageIndex++] ?? [],
      discoverNext: () => "https://example.com/catalog/next/",
    });
    expect(result.pagesFetched).toBe(3);
    expect(result.refs).toHaveLength(1);
  });
});
