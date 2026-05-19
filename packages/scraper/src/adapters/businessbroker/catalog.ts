import * as cheerio from "cheerio";
import type { ListingRef } from "@clearbolt/core";
import {
  discoverNextPageUrl,
  linkSelectorNextStrategy,
  normalizePageUrl,
  paginationNavNextStrategy,
  queryPageStrategy,
  relNextStrategy,
  type PaginationStrategy,
} from "../../discovery/pagination/index.js";
import { mergeListingRefsIntoMap } from "../../discovery/listing-ref-merge.js";
import type { CatalogAdapter } from "../types.js";
import {
  isBusinessBrokerCatalogUrl,
  listingRefFromBusinessBrokerUrl,
} from "../../businessbroker-listing-url.js";

export { isBusinessBrokerCatalogUrl, BUSINESSBROKER_CALIFORNIA_CATALOG_URL } from "../../businessbroker-listing-url.js";

const LISTING_HREF = /\/business-for-sale\/[^/]+\/\d+\.aspx/i;

export function catalogPageNumberFromUrl(url: string): number {
  const page = new URL(url).searchParams.get("page");
  if (!page) return 1;
  const n = Number.parseInt(page, 10);
  return Number.isNaN(n) || n < 1 ? 1 : n;
}

export function buildBusinessBrokerCatalogPageUrl(
  catalogBaseUrl: string,
  pageNum: number,
): string {
  const u = new URL(catalogBaseUrl);
  if (pageNum <= 1) {
    u.search = "";
  } else {
    u.searchParams.set("page", String(pageNum));
  }
  return normalizePageUrl(u.toString());
}

export function recoverBusinessBrokerCatalogPageUrl(
  catalogBaseUrl: string,
  pageNumber: number,
): string {
  return buildBusinessBrokerCatalogPageUrl(catalogBaseUrl, pageNumber);
}

export function normalizeBusinessBrokerCatalogUrlForCompare(
  url: string,
): string {
  const u = new URL(url);
  const page = catalogPageNumberFromUrl(url);
  if (page <= 1) {
    u.search = "";
  } else {
    u.searchParams.set("page", String(page));
  }
  u.hash = "";
  return normalizePageUrl(u.toString());
}

const businessBrokerPagerLinkStrategy = linkSelectorNextStrategy({
  id: "businessbroker-pager-href",
  selectors:
    "a.pagination-next[href], li.next a[href], a[rel='next'][href], a.next[href]",
});

export const businessBrokerCatalogPaginationStrategies: readonly PaginationStrategy[] =
  [relNextStrategy, businessBrokerPagerLinkStrategy, paginationNavNextStrategy, queryPageStrategy];

function catalogHtmlHasListingAnchors(html: string): boolean {
  return LISTING_HREF.test(html);
}

function maxCatalogPageNumberInHtml(html: string, catalogPathname: string): number {
  const escaped = catalogPathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\?page=(\\d+)`, "gi");
  let max = 0;
  for (const m of html.matchAll(re)) {
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

export function synthesizeNextBusinessBrokerCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const base = new URL(currentUrl);
  const current = catalogPageNumberFromUrl(currentUrl);
  const maxInHtml = maxCatalogPageNumberInHtml(html, base.pathname);
  if (maxInHtml > current) {
    return buildBusinessBrokerCatalogPageUrl(currentUrl, current + 1);
  }
  if (catalogHtmlHasListingAnchors(html)) {
    return buildBusinessBrokerCatalogPageUrl(currentUrl, current + 1);
  }
  return null;
}

export function discoverNextBusinessBrokerCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const fromStrategies = discoverNextPageUrl(
    html,
    currentUrl,
    businessBrokerCatalogPaginationStrategies,
  );
  if (fromStrategies && isBusinessBrokerCatalogUrl(fromStrategies)) {
    const samePage =
      normalizeBusinessBrokerCatalogUrlForCompare(fromStrategies) ===
      normalizeBusinessBrokerCatalogUrlForCompare(currentUrl);
    if (!samePage) return fromStrategies;
  }
  return synthesizeNextBusinessBrokerCatalogPageUrl(html, currentUrl);
}

export async function discoverListingRefsFromBusinessBrokerCatalogPage(
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
      const ref = listingRefFromBusinessBrokerUrl(abs);
      if (ref) mergeListingRefsIntoMap(merged, [ref]);
    } catch {
      /* ignore bad href */
    }
  });

  return [...merged.values()];
}

export const businessBrokerCatalogAdapter: CatalogAdapter = {
  id: "businessbroker",
  isCatalogUrl: isBusinessBrokerCatalogUrl,
  discoverListingRefsFromPage: discoverListingRefsFromBusinessBrokerCatalogPage,
  paginationStrategies: businessBrokerCatalogPaginationStrategies,
  discoverNextPage: discoverNextBusinessBrokerCatalogPageUrl,
};
