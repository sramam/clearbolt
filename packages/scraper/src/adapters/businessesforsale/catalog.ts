import * as cheerio from "cheerio";
import type { ListingRef } from "@clearbolt/core";
import {
  discoverNextPageUrl,
  linkSelectorNextStrategy,
  normalizePageUrl,
  paginationNavNextStrategy,
  relNextStrategy,
  type PaginationStrategy,
} from "../../discovery/pagination/index.js";
import { discoverListingRefsFromJsonLd } from "../../discovery/json-ld-item-list.js";
import { mergeListingRefsIntoMap } from "../../discovery/listing-ref-merge.js";
import type { CatalogAdapter } from "../types.js";
import {
  catalogPageNumberFromPathname,
  catalogSlugFromPathname,
  isBusinessesForSaleCatalogUrl,
  isBusinessesForSaleListingUrl,
  listingRefFromBusinessesForSaleUrl,
} from "../../businessesforsale-listing-url.js";

export {
  BUSINESSES_FOR_SALE_CALIFORNIA_CATALOG_URL,
  isBusinessesForSaleCatalogUrl,
} from "../../businessesforsale-listing-url.js";

export function buildBusinessesForSaleCatalogPageUrl(
  catalogBaseUrl: string,
  pageNum: number,
): string {
  const u = new URL(catalogBaseUrl);
  const slug = catalogSlugFromPathname(u.pathname);
  if (!slug) return normalizePageUrl(catalogBaseUrl);
  const segment = pageNum <= 1 ? slug : `${slug}-${pageNum}`;
  u.pathname = `/us/search/${segment}`;
  u.search = "";
  u.hash = "";
  return normalizePageUrl(u.toString());
}

export function recoverBusinessesForSaleCatalogPageUrl(
  catalogBaseUrl: string,
  pageNumber: number,
): string {
  return buildBusinessesForSaleCatalogPageUrl(catalogBaseUrl, pageNumber);
}

export function normalizeBusinessesForSaleCatalogUrlForCompare(
  url: string,
): string {
  const u = new URL(url);
  const slug = catalogSlugFromPathname(u.pathname);
  if (!slug) return normalizePageUrl(url);
  const page = catalogPageNumberFromPathname(u.pathname);
  u.pathname =
    page <= 1 ? `/us/search/${slug}` : `/us/search/${slug}-${page}`;
  u.search = "";
  u.hash = "";
  return normalizePageUrl(u.toString());
}

const businessesForSalePagerLinkStrategy = linkSelectorNextStrategy({
  id: "bfs-pager-href",
  selectors: 'a[rel="next"][href], .pagination a.next[href]',
});

export const businessesForSaleCatalogPaginationStrategies: readonly PaginationStrategy[] =
  [relNextStrategy, businessesForSalePagerLinkStrategy, paginationNavNextStrategy];

function catalogHtmlHasListingAnchors(html: string): boolean {
  return /\/us\/[^/"'\s]+\.aspx/i.test(html);
}

function maxCatalogPageNumberInHtml(html: string, catalogSlug: string): number {
  const escaped = catalogSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`/us/search/${escaped}-(\\d+)`, "gi");
  let max = 0;
  for (const m of html.matchAll(re)) {
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

export function synthesizeNextBusinessesForSaleCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const base = new URL(currentUrl);
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return null;
  const current = catalogPageNumberFromPathname(base.pathname);
  if (maxCatalogPageNumberInHtml(html, slug) > current) {
    return buildBusinessesForSaleCatalogPageUrl(currentUrl, current + 1);
  }
  if (catalogHtmlHasListingAnchors(html)) {
    return buildBusinessesForSaleCatalogPageUrl(currentUrl, current + 1);
  }
  return null;
}

export function discoverNextBusinessesForSaleCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const fromStrategies = discoverNextPageUrl(
    html,
    currentUrl,
    businessesForSaleCatalogPaginationStrategies,
  );
  if (fromStrategies && isBusinessesForSaleCatalogUrl(fromStrategies)) {
    const samePage =
      normalizeBusinessesForSaleCatalogUrlForCompare(fromStrategies) ===
      normalizeBusinessesForSaleCatalogUrlForCompare(currentUrl);
    if (!samePage) return fromStrategies;
  }
  return synthesizeNextBusinessesForSaleCatalogPageUrl(html, currentUrl);
}

function discoverBusinessesForSaleListingRefsFromJsonLd(
  html: string,
): ListingRef[] {
  return discoverListingRefsFromJsonLd(html, {
    urlMatches: (url) => isBusinessesForSaleListingUrl(url),
  });
}

export async function discoverListingRefsFromBusinessesForSaleCatalogPage(
  html: string,
  pageUrl: string,
): Promise<ListingRef[]> {
  const merged = new Map<string, ListingRef>();
  for (const ref of discoverBusinessesForSaleListingRefsFromJsonLd(html)) {
    mergeListingRefsIntoMap(merged, [ref]);
  }

  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#")) return;
    try {
      const abs = new URL(href, base).toString();
      const normalized = new URL(abs);
      normalized.hash = "";
      normalized.search = "";
      if ([...merged.values()].some((r) => r.url === normalized.toString())) {
        return;
      }
      const ref = listingRefFromBusinessesForSaleUrl(abs);
      if (ref) mergeListingRefsIntoMap(merged, [ref]);
    } catch {
      /* ignore bad href */
    }
  });

  return [...merged.values()];
}

export const businessesForSaleCatalogAdapter: CatalogAdapter = {
  id: "businessesforsale",
  isCatalogUrl: isBusinessesForSaleCatalogUrl,
  discoverListingRefsFromPage:
    discoverListingRefsFromBusinessesForSaleCatalogPage,
  paginationStrategies: businessesForSaleCatalogPaginationStrategies,
  discoverNextPage: discoverNextBusinessesForSaleCatalogPageUrl,
};
