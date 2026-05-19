import { discoverListingRefs } from "../adapters/bizbuysell.js";
import type { BizBuySellLiveCacheV1 } from "./bizbuysell-fixture-cache.js";
import { maskBizBuySellHtml } from "./mask-bizbuysell-html.js";

export type ValidateBizBuySellLiveCacheOptions = {
  /** When true (default), require ≥1 discoverable listing ref on the search page. */
  requireDiscoverableSearch?: boolean;
};

function isBizBuySellHost(hostname: string): boolean {
  return hostname.toLowerCase().includes("bizbuysell");
}

/** Applies {@link maskBizBuySellHtml} to search + listing bodies (new object). */
export function applyBizBuySellLiveCacheHtmlMask(
  cache: BizBuySellLiveCacheV1,
): BizBuySellLiveCacheV1 {
  return {
    ...cache,
    searchHtml: maskBizBuySellHtml(cache.searchHtml),
    listings: cache.listings.map((L) => ({
      ...L,
      html: maskBizBuySellHtml(L.html),
    })),
  };
}

/**
 * Omits `fetchedAt` and masks HTML so two captures can be diffed without timestamp
 * or volatile markup noise.
 */
export function serializeBizBuySellLiveCacheForCompare(
  cache: BizBuySellLiveCacheV1,
): string {
  const masked = applyBizBuySellLiveCacheHtmlMask(cache);
  return JSON.stringify({
    version: masked.version,
    searchUrl: masked.searchUrl,
    searchHtml: masked.searchHtml,
    listings: masked.listings.map(({ requestUrl, finalUrl, html }) => ({
      requestUrl,
      finalUrl,
      html,
    })),
  });
}

/**
 * Structural checks: `fetchedAt` is only validated as parseable (value is churn).
 * HTML body checks are on raw strings; pair with masking for golden compares.
 */
export async function validateBizBuySellLiveCacheInvariants(
  cache: BizBuySellLiveCacheV1,
  options: ValidateBizBuySellLiveCacheOptions = {},
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  const requireDiscover = options.requireDiscoverableSearch !== false;

  if (cache.version !== 1) errors.push("version must be 1");
  if (Number.isNaN(Date.parse(cache.fetchedAt)))
    errors.push("fetchedAt must be parseable as a date");

  let searchHost = "";
  try {
    searchHost = new URL(cache.searchUrl).hostname;
  } catch {
    errors.push("searchUrl must be a valid URL");
  }
  if (searchHost && !isBizBuySellHost(searchHost))
    errors.push("searchUrl host must be a bizbuysell domain");

  if (!cache.searchHtml.trim()) errors.push("searchHtml must be non-empty");

  if (!Array.isArray(cache.listings) || cache.listings.length < 1) {
    errors.push("listings must contain at least one entry");
  }

  for (let i = 0; i < cache.listings.length; i++) {
    const L = cache.listings[i];
    const p = `listings[${i}]`;
    try {
      const h = new URL(L.requestUrl).hostname;
      if (!isBizBuySellHost(h)) errors.push(`${p}.requestUrl host invalid`);
    } catch {
      errors.push(`${p}.requestUrl must be a valid URL`);
    }
    try {
      const h = new URL(L.finalUrl).hostname;
      if (!isBizBuySellHost(h)) errors.push(`${p}.finalUrl host invalid`);
    } catch {
      errors.push(`${p}.finalUrl must be a valid URL`);
    }
    if (!L.html.trim()) errors.push(`${p}.html must be non-empty`);
  }

  if (requireDiscover && errors.length === 0) {
    let discovered = 0;
    for await (const _ of discoverListingRefs(
      cache.searchHtml,
      cache.searchUrl,
    )) {
      discovered++;
      break;
    }
    if (discovered < 1)
      errors.push("searchHtml must yield at least one listing ref");
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
