import * as cheerio from "cheerio";
import type { ListingRef } from "@clearbolt/core";
import {
  discoverNextPageUrl,
  linkSelectorNextStrategy,
  normalizePageUrl,
  paginationNavNextStrategy,
  pathIncrementStrategy,
  relNextStrategy,
  type PaginationStrategy,
} from "../../discovery/pagination/index.js";
import { mergeListingRefsIntoMap } from "../../discovery/listing-ref-merge.js";
import type { CatalogAdapter } from "../types.js";
import {
  catalogPageNumberFromPathname,
  catalogSlugFromPathname,
  isDealStreamCatalogUrl,
  listingRefFromDealStreamUrl,
} from "../../dealstream-listing-url.js";

export {
  DEALSTREAM_CALIFORNIA_CATALOG_URL,
  isDealStreamCatalogUrl,
} from "../../dealstream-listing-url.js";

const CATALOG_PATH =
  /^\/(?:(?:biz-sale)|(?:[a-z0-9-]+\/)*[a-z0-9-]+-businesses-for-sale|(?:off-market|new-arrivals)-businesses-for-sale)(?:\/\d+)?\/?$/i;

export function buildDealStreamCatalogPageUrl(
  catalogBaseUrl: string,
  pageNum: number,
): string {
  const slug = catalogSlugFromPathname(new URL(catalogBaseUrl).pathname);
  if (!slug) return normalizePageUrl(catalogBaseUrl);
  const u = new URL(catalogBaseUrl);
  u.pathname = pageNum <= 1 ? `${slug}/` : `${slug}/${pageNum}/`;
  u.search = "";
  u.hash = "";
  return normalizePageUrl(u.toString());
}

export function recoverDealStreamCatalogPageUrl(
  catalogBaseUrl: string,
  pageNumber: number,
): string {
  return buildDealStreamCatalogPageUrl(catalogBaseUrl, pageNumber);
}

export function normalizeDealStreamCatalogUrlForCompare(url: string): string {
  const base = new URL(url);
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return normalizePageUrl(url);
  const page = catalogPageNumberFromPathname(base.pathname);
  base.pathname = page <= 1 ? `${slug}/` : `${slug}/${page}/`;
  base.search = "";
  base.hash = "";
  return normalizePageUrl(base.toString());
}

const dealStreamPagerLinkStrategy = linkSelectorNextStrategy({
  id: "dealstream-pager-href",
  selectors: 'a[rel="next"][href]',
});

const dealStreamPathPagination = pathIncrementStrategy({
  id: "dealstream-path",
  catalogPathPattern: CATALOG_PATH,
  pageFromPathname: catalogPageNumberFromPathname,
  pageFromLinkPathname: (pathname) => {
    const slug = catalogSlugFromPathname(pathname);
    if (!slug) return null;
    const page = catalogPageNumberFromPathname(pathname);
    return page >= 1 ? page : null;
  },
  buildPageUrl: (base, pageNum) => buildDealStreamCatalogPageUrl(base.toString(), pageNum),
});

export const dealStreamCatalogPaginationStrategies: readonly PaginationStrategy[] =
  [
    relNextStrategy,
    dealStreamPagerLinkStrategy,
    paginationNavNextStrategy,
    dealStreamPathPagination,
  ];

function catalogHtmlHasListingAnchors(html: string): boolean {
  return /\/d\/biz-sale\//i.test(html);
}

function maxCatalogPageNumberInHtml(html: string, catalogSlug: string): number {
  const escaped = catalogSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}/(\\d+)/`, "gi");
  let max = 0;
  for (const m of html.matchAll(re)) {
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

export function synthesizeNextDealStreamCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const base = new URL(currentUrl);
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return null;
  const current = catalogPageNumberFromPathname(base.pathname);
  if (maxCatalogPageNumberInHtml(html, slug) > current) {
    return buildDealStreamCatalogPageUrl(currentUrl, current + 1);
  }
  if (catalogHtmlHasListingAnchors(html)) {
    return buildDealStreamCatalogPageUrl(currentUrl, current + 1);
  }
  return null;
}

export function discoverNextDealStreamCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const fromStrategies = discoverNextPageUrl(
    html,
    currentUrl,
    dealStreamCatalogPaginationStrategies,
  );
  if (fromStrategies && isDealStreamCatalogUrl(fromStrategies)) {
    const samePage =
      normalizeDealStreamCatalogUrlForCompare(fromStrategies) ===
      normalizeDealStreamCatalogUrlForCompare(currentUrl);
    if (!samePage) {
      return normalizeDealStreamCatalogUrlForCompare(fromStrategies);
    }
  }
  return synthesizeNextDealStreamCatalogPageUrl(html, currentUrl);
}

export async function discoverListingRefsFromDealStreamCatalogPage(
  html: string,
  pageUrl: string,
): Promise<ListingRef[]> {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const merged = new Map<string, ListingRef>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#")) return;
    try {
      const abs = new URL(href, base).toString();
      const ref = listingRefFromDealStreamUrl(abs);
      if (ref) mergeListingRefsIntoMap(merged, [ref]);
    } catch {
      /* ignore bad href */
    }
  });

  return [...merged.values()];
}

export const dealStreamCatalogAdapter: CatalogAdapter = {
  id: "dealstream",
  isCatalogUrl: isDealStreamCatalogUrl,
  discoverListingRefsFromPage: discoverListingRefsFromDealStreamCatalogPage,
  paginationStrategies: dealStreamCatalogPaginationStrategies,
  discoverNextPage: discoverNextDealStreamCatalogPageUrl,
};
