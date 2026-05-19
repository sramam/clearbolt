import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawResponse } from "@clearbolt/core";
import { MockFetcher } from "../mock-fetcher.js";
import {
  BIZBUYSELL_LIVE_CACHE_FILENAME,
  parseBizBuySellLiveCache,
} from "./bizbuysell-fixture-cache.js";

const _dir = dirname(fileURLToPath(import.meta.url));

/** Default: `packages/scraper/tests/fixtures`. */
export function defaultBizBuySellFixtureRoot(): string {
  return join(_dir, "..", "..", "tests", "fixtures");
}

export type BizBuySellFixtureBundle = {
  fetcher: MockFetcher;
  /** Search URL present in the mock map (pass to `discoverListingRefs` as base). */
  fixtureSearchUrl: string;
};

/**
 * Prefer `bizbuysell-live-cache.json` when present (real listing URLs + HTML);
 * otherwise replay checked-in static HTML (synthetic listing ids).
 */
export async function buildBizBuySellFixtureFetcher(
  root = defaultBizBuySellFixtureRoot(),
): Promise<BizBuySellFixtureBundle> {
  const staticSearch = "https://www.bizbuysell.com/businesses-for-sale/";
  const livePath = join(root, BIZBUYSELL_LIVE_CACHE_FILENAME);
  try {
    const raw = await readFile(livePath, "utf8");
    const cache = parseBizBuySellLiveCache(raw);
    if (cache?.listings.length) {
      const map = new Map<string, RawResponse>();
      map.set(cache.searchUrl, {
        status: 200,
        body: cache.searchHtml,
        finalUrl: cache.searchUrl,
        headers: {},
      });
      for (const L of cache.listings) {
        map.set(L.requestUrl, {
          status: 200,
          body: L.html,
          finalUrl: L.finalUrl,
          headers: {},
        });
      }
      return {
        fetcher: new MockFetcher(map),
        fixtureSearchUrl: cache.searchUrl,
      };
    }
  } catch {
    // missing or unreadable live cache — fall back
  }

  const search = await readFile(join(root, "bizbuysell-search.html"), "utf8");
  const listingA = await readFile(
    join(root, "bizbuysell-listing-1234567.html"),
    "utf8",
  );
  let listingB: string;
  try {
    listingB = await readFile(
      join(root, "bizbuysell-listing-7654321.html"),
      "utf8",
    );
  } catch {
    listingB = listingA;
  }
  const map = new Map<string, RawResponse>();
  map.set(staticSearch, {
    status: 200,
    body: search,
    finalUrl: staticSearch,
    headers: {},
  });
  for (const u of [
    "https://www.bizbuysell.com/california-business-for-sale/1234567/",
    "https://www.bizbuysell.com/florida-business-for-sale/1234567/",
  ]) {
    map.set(u, { status: 200, body: listingA, finalUrl: u, headers: {} });
  }
  map.set("https://www.bizbuysell.com/texas-business-for-sale/7654321/", {
    status: 200,
    body: listingB,
    finalUrl: "https://www.bizbuysell.com/texas-business-for-sale/7654321/",
    headers: {},
  });
  return { fetcher: new MockFetcher(map), fixtureSearchUrl: staticSearch };
}
