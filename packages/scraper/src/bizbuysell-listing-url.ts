import type { ListingRef } from "@clearbolt/core";

const LISTING_ID = /(\d{6,})/;
const LISTING_SEGMENT =
  /\/(business-opportunity|business-for-sale|business-asset)\//i;
/** Regional (`/california-businesses-for-sale/`) or nationwide (`/businesses-for-sale/`) catalog index. */
const CATALOG_PATH =
  /(?:^\/businesses-for-sale|-businesses-for-sale)(?:\/\d+)?\/?$/i;

/** Listing number from a BizBuySell listing pathname, or undefined if not a listing path. */
export function extractBizBuySellListingIdFromPathname(
  pathname: string,
): string | undefined {
  if (!isBizBuySellListingPathname(pathname)) return undefined;
  return pathname.match(LISTING_ID)?.[1];
}

function isBizBuySellListingPathname(pathname: string): boolean {
  if (CATALOG_PATH.test(pathname)) return false;
  if (LISTING_SEGMENT.test(pathname)) return LISTING_ID.test(pathname);
  // e.g. /california-business-for-sale/1111001/ (singular business-for-sale + id)
  return /-business-for-sale\/\d{6,}\/?$/i.test(pathname);
}

export function isBizBuySellCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("bizbuysell.com")) return false;
    if (!CATALOG_PATH.test(u.pathname)) return false;
    if (/^\/businesses-for-sale/i.test(u.pathname)) {
      return !u.searchParams.has("q") && !u.searchParams.has("geo");
    }
    return true;
  } catch {
    return false;
  }
}

export function isBizBuySellListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("bizbuysell")) return false;
    return isBizBuySellListingPathname(u.pathname);
  } catch {
    return false;
  }
}

export function listingRefFromBizBuySellUrl(url: string): ListingRef | null {
  if (!isBizBuySellListingUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  const externalId = extractBizBuySellListingIdFromPathname(u.pathname);
  return { url: u.toString(), externalId };
}
