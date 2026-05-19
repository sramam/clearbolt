import type { ListingRef } from "@clearbolt/core";

export const BUSINESSES_FOR_SALE_HOST = "businessesforsale.com";

export const BUSINESSES_FOR_SALE_CALIFORNIA_CATALOG_URL =
  "https://us.businessesforsale.com/us/search/california";

const LISTING_PATH = /^\/us\/([^/]+)\.aspx$/i;

const NON_LISTING_SLUG =
  /^(?:advancedsearch|login|forgotpassword|subscribe|shortlist|emailalerts?|advertise|faq|buyer-registration|sellerreferral)$/i;

const EXCLUDED_CATALOG_SLUG =
  /^(?:last-3-days|last-14-days|last-months|last-3-months|quick-sale|distressed|turnaround-opportunity|bankruptcy|closed-asset-sale|real-property)$/i;

/** `/us/search/{slug}` or `/us/search/{slug}-{page}` (page ≥ 2). */
export function catalogSlugFromPathname(pathname: string): string | null {
  const m = pathname.match(/^\/us\/search\/([^/]+)\/?$/i);
  if (!m) return null;
  const segment = m[1]!;
  const pageSuffix = segment.match(/^(.+)-(\d+)$/);
  if (pageSuffix) {
    const page = Number.parseInt(pageSuffix[2]!, 10);
    if (!Number.isNaN(page) && page >= 2) return pageSuffix[1]!;
  }
  return segment;
}

export function catalogPageNumberFromPathname(pathname: string): number {
  const m = pathname.match(/^\/us\/search\/([^/]+)\/?$/i);
  if (!m) return 1;
  const pageSuffix = m[1]!.match(/-(\d+)$/);
  if (pageSuffix) {
    const n = Number.parseInt(pageSuffix[1]!, 10);
    if (!Number.isNaN(n) && n >= 1) return n;
  }
  return 1;
}

export function isBusinessesForSaleCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(BUSINESSES_FOR_SALE_HOST)) return false;
    if (u.search) return false;
    const slug = catalogSlugFromPathname(u.pathname);
    if (!slug) return false;
    if (EXCLUDED_CATALOG_SLUG.test(slug)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isBusinessesForSaleListingPathname(pathname: string): boolean {
  const m = pathname.match(LISTING_PATH);
  if (!m) return false;
  return !NON_LISTING_SLUG.test(m[1]!);
}

export function isBusinessesForSaleListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(BUSINESSES_FOR_SALE_HOST)) return false;
    return isBusinessesForSaleListingPathname(u.pathname);
  } catch {
    return false;
  }
}

export function listingRefFromBusinessesForSaleUrl(
  url: string,
  externalId?: string,
): ListingRef | null {
  if (!isBusinessesForSaleListingUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return { url: u.toString(), externalId };
}
