import type { ListingRef } from "@clearbolt/core";

export const LOOPNET_HOST = "loopnet.com";

/**
 * LoopNet listing detail paths. Both legacy and the current Angular SPA layout:
 * - Legacy:  `/Listing/{slug}/{numericId}/`
 * - Current: `/biz/business-opportunity/{slug}/{numericId}/` (Angular `/biz/` SPA)
 * - Variant: `/biz/business-for-sale/{slug}/{numericId}/`   (occasionally seen)
 */
const LISTING_PATH =
  /^(?:\/Listing\/[^/]+\/(\d+)\/?|\/biz\/business-(?:opportunity|for-sale)\/[^/]+\/(\d+)\/?)$/i;

/**
 * LoopNet biz catalog indexes:
 * - `/biz/{geo}-businesses-for-sale/` (e.g. california-businesses-for-sale)
 * - `/biz/{geo}/{facet}-businesses/` (e.g. california-united-states/businesses-for-sale)
 * Optional trailing `/{page}`. The Angular `/biz/` SPA emits both single- and
 * double-slash variants between slug and page (`…/2/` and `…//2/`), so we
 * accept one or more slashes via `\/+`.
 */
const CATALOG_PATH =
  /^\/biz\/(?:[^/]+\/[^/]*businesses[^/]*|[^/]*businesses(?:-for-sale)?)(?:\/+\d+)?\/?$/i;

export const LOOPNET_CALIFORNIA_CATALOG_URL =
  "https://www.loopnet.com/biz/california-businesses-for-sale/";

export function extractLoopNetListingIdFromPathname(
  pathname: string,
): string | undefined {
  const m = pathname.match(LISTING_PATH);
  return m?.[1] ?? m?.[2];
}

export function isLoopNetListingPathname(pathname: string): boolean {
  return LISTING_PATH.test(pathname);
}

export function isLoopNetCatalogPathname(pathname: string): boolean {
  if (/^\/Listing\//i.test(pathname)) return false;
  if (/^\/biz\/business-(?:opportunity|for-sale)\//i.test(pathname))
    return false;
  return CATALOG_PATH.test(pathname);
}

export function isLoopNetCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(LOOPNET_HOST)) return false;
    return isLoopNetCatalogPathname(u.pathname);
  } catch {
    return false;
  }
}

export function isLoopNetListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(LOOPNET_HOST)) return false;
    return isLoopNetListingPathname(u.pathname);
  } catch {
    return false;
  }
}

export function listingRefFromLoopNetUrl(url: string): ListingRef | null {
  if (!isLoopNetListingUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  if (!u.hostname.startsWith("www.")) {
    u.hostname = `www.${u.hostname.replace(/^www\./, "")}`;
  }
  const externalId = extractLoopNetListingIdFromPathname(u.pathname);
  return { url: u.toString(), externalId };
}
