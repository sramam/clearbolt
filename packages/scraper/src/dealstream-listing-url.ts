import type { ListingRef } from "@clearbolt/core";

export const DEALSTREAM_HOST = "dealstream.com";

export const DEALSTREAM_CALIFORNIA_CATALOG_URL =
  "https://dealstream.com/california-businesses-for-sale";

const LISTING_PATH = /^\/d\/biz-sale\/[^/]+\/([a-z0-9]+)\/?$/i;

export function extractDealStreamListingIdFromPathname(
  pathname: string,
): string | undefined {
  const m = pathname.match(LISTING_PATH);
  return m?.[1];
}

export function isDealStreamListingPathname(pathname: string): boolean {
  return LISTING_PATH.test(pathname);
}

export function catalogSlugFromPathname(pathname: string): string | null {
  const normalized = pathname.replace(/\/$/, "") || "/";
  const bizSale = normalized.match(/^(\/biz-sale)(?:\/\d+)?$/i);
  if (bizSale) return bizSale[1]!;
  const feature = normalized.match(
    /^(\/(?:off-market|new-arrivals)-businesses-for-sale)(?:\/\d+)?$/i,
  );
  if (feature) return feature[1]!;
  const geo = normalized.match(/^(.+-businesses-for-sale)(?:\/\d+)?$/i);
  return geo?.[1] ?? null;
}

export function catalogPageNumberFromPathname(pathname: string): number {
  const normalized = pathname.replace(/\/$/, "") || "/";
  const m = normalized.match(/\/(\d+)$/);
  if (m) {
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isNaN(n) && n >= 1) return n;
  }
  return 1;
}

export function isDealStreamCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(DEALSTREAM_HOST)) return false;
    return catalogSlugFromPathname(u.pathname) !== null;
  } catch {
    return false;
  }
}

export function isDealStreamListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(DEALSTREAM_HOST)) return false;
    return isDealStreamListingPathname(u.pathname);
  } catch {
    return false;
  }
}

export function listingRefFromDealStreamUrl(url: string): ListingRef | null {
  if (!isDealStreamListingUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  const externalId = extractDealStreamListingIdFromPathname(u.pathname);
  return { url: u.toString(), externalId };
}
