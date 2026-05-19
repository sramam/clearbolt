const BIZBUYSELL_SEARCH_BASE =
  "https://www.bizbuysell.com/businesses-for-sale/";

export interface BizBuySellSearchParams {
  /** Free-text keywords (maps to `q`). */
  keywords?: string;
  /** Location / geo filter when supported by BizBuySell. */
  geo?: string;
}

/** Build a BizBuySell search results URL from keywords and optional geo. */
export function buildBizBuySellSearchUrl(
  params: BizBuySellSearchParams,
): string {
  const url = new URL(BIZBUYSELL_SEARCH_BASE);
  const q = params.keywords?.trim();
  if (q) url.searchParams.set("q", q);
  const geo = params.geo?.trim();
  if (geo) url.searchParams.set("geo", geo);
  return url.toString();
}
