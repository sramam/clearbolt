import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  discoverListingRefs,
  fetchListingHtmlWithWafPolicy,
} from "../adapters/bizbuysell.js";
import { fetchHtmlWithHttpWafPolicy } from "../fetch-with-waf-policy.js";
import { HttpFetcher } from "../http-fetcher.js";
import type { BizBuySellLiveCacheV1 } from "./bizbuysell-fixture-cache.js";
import { BIZBUYSELL_LIVE_CACHE_FILENAME } from "./bizbuysell-fixture-cache.js";
import { applyBizBuySellLiveCacheHtmlMask } from "./bizbuysell-live-cache-validate.js";
import { defaultBizBuySellFixtureRoot } from "./build-bizbuysell-fixture-fetcher.js";

export type RefreshBizBuySellLiveCacheOptions = {
  /** Search page URL to fetch (must match links on the page). */
  searchUrl: string;
  /** Max listing detail pages to snapshot. */
  listingLimit: number;
  /** Directory containing `bizbuysell-live-cache.json` (default: package fixtures). */
  fixtureRoot?: string;
  /**
   * When true, strips volatile markup (scripts, common ad shells) before write.
   * Prefer for committed fixtures; set via `BIZBUYSELL_FIXTURE_MASK_HTML=1` on refresh.
   */
  maskHtml?: boolean;
};

/**
 * Live network fetch: search HTML + first N listing pages, written as
 * `bizbuysell-live-cache.json` for `buildBizBuySellFixtureFetcher`.
 */
export async function refreshBizBuySellLiveCache(
  options: RefreshBizBuySellLiveCacheOptions,
): Promise<{ outPath: string; cache: BizBuySellLiveCacheV1 }> {
  const fixtureRoot = options.fixtureRoot ?? defaultBizBuySellFixtureRoot();
  const fetcher = new HttpFetcher();
  const wafPolicy = {
    persistNeedsBrowser: async () => {},
    maxHttpAttempts: 3,
    throttleMsBetweenRetries: 75,
  };
  const searchRes = await fetchHtmlWithHttpWafPolicy(
    fetcher,
    options.searchUrl,
    wafPolicy,
  );
  if (searchRes.status < 200 || searchRes.status >= 300) {
    throw new Error(
      `search fetch failed ${searchRes.status} for ${options.searchUrl}`,
    );
  }
  const searchHtml = searchRes.body;
  const effectiveSearch = searchRes.finalUrl || options.searchUrl;

  const refs: { url: string; externalId?: string }[] = [];
  for await (const r of discoverListingRefs(searchHtml, effectiveSearch)) {
    refs.push(r);
  }
  refs.sort((a, b) => a.url.localeCompare(b.url));
  const picked = refs.slice(0, Math.max(0, options.listingLimit));

  const listings: BizBuySellLiveCacheV1["listings"] = [];
  for (const ref of picked) {
    const { html, finalUrl } = await fetchListingHtmlWithWafPolicy(
      fetcher,
      ref,
      wafPolicy,
    );
    listings.push({ requestUrl: ref.url, finalUrl, html });
  }

  let cache: BizBuySellLiveCacheV1 = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    searchUrl: effectiveSearch,
    searchHtml,
    listings,
  };
  if (options.maskHtml) {
    cache = applyBizBuySellLiveCacheHtmlMask(cache);
  }
  const outPath = join(fixtureRoot, BIZBUYSELL_LIVE_CACHE_FILENAME);
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(cache)}\n`, "utf8");
  return { outPath, cache };
}
