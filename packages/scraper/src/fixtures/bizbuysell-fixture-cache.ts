export const BIZBUYSELL_LIVE_CACHE_FILENAME = "bizbuysell-live-cache.json";

/** Serialized snapshot for `MockFetcher` (CLI `--fixtures`, local UI against replayed HTML). */
export type BizBuySellLiveCacheV1 = {
  version: 1;
  fetchedAt: string;
  searchUrl: string;
  searchHtml: string;
  listings: Array<{
    requestUrl: string;
    finalUrl: string;
    html: string;
  }>;
};

export function parseBizBuySellLiveCache(
  raw: string,
): BizBuySellLiveCacheV1 | null {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.version !== 1) return null;
  const fetchedAtRaw = o.fetchedAt;
  const fetchedAt =
    typeof fetchedAtRaw === "string" && fetchedAtRaw.trim()
      ? fetchedAtRaw.trim()
      : "1970-01-01T00:00:00.000Z";
  if (typeof o.searchUrl !== "string") return null;
  if (typeof o.searchHtml !== "string") return null;
  if (!Array.isArray(o.listings)) return null;
  const listings: BizBuySellLiveCacheV1["listings"] = [];
  for (const row of o.listings) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.requestUrl !== "string") return null;
    if (typeof r.finalUrl !== "string") return null;
    if (typeof r.html !== "string") return null;
    listings.push({
      requestUrl: r.requestUrl,
      finalUrl: r.finalUrl,
      html: r.html,
    });
  }
  return {
    version: 1,
    fetchedAt,
    searchUrl: o.searchUrl,
    searchHtml: o.searchHtml,
    listings,
  };
}
