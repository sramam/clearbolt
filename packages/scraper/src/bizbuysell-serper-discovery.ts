import type { ListingRef } from "@clearbolt/core";
import { listingRefFromBizBuySellUrl } from "./bizbuysell-listing-url.js";
import { serperSearch, type SerperSearchOptions } from "./serper-client.js";

export {
  isBizBuySellListingUrl,
  listingRefFromBizBuySellUrl,
} from "./bizbuysell-listing-url.js";

/** Google query tuned for individual BizBuySell listing pages (not category hubs). */
export function buildBizBuySellSerperQuery(keywords: string): string {
  const kw = keywords.trim();
  const base =
    "site:bizbuysell.com (inurl:business-opportunity OR inurl:business-for-sale OR inurl:business-asset)";
  return kw ? `${base} ${kw}` : `${base} "cash flow"`;
}

export async function discoverBizBuySellListingRefsFromSerper(
  keywords: string,
  limit: number,
  serperOpts: SerperSearchOptions = {},
): Promise<{ refs: ListingRef[]; serperQuery: string; raw: unknown }> {
  const serperQuery = buildBizBuySellSerperQuery(keywords);
  const raw = await serperSearch(serperQuery, {
    ...serperOpts,
    num: Math.min(Math.max(limit, 1), 100),
  });

  const refs: ListingRef[] = [];
  const seen = new Set<string>();
  for (const row of raw.organic ?? []) {
    if (!row.link) continue;
    const ref = listingRefFromBizBuySellUrl(row.link);
    if (!ref) continue;
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    refs.push(ref);
    if (refs.length >= limit) break;
  }

  return { refs, serperQuery, raw };
}

export const BIZBUYSELL_SERP_DISCOVERY_ADAPTER_NOTE = "bizbuysell";
