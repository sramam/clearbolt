import type { ListingRef } from "@clearbolt/core";
import {
  isBizBuySellCatalogUrl,
  listingRefFromBizBuySellUrl,
} from "../../bizbuysell-listing-url.js";
import { discoverListingRefsFromJsonLd } from "../../discovery/json-ld-item-list.js";
import { mergeListingRefsIntoMap } from "../../discovery/listing-ref-merge.js";
import {
  type PaginationStrategy,
  discoverNextPageUrl,
  linkSelectorNextStrategy,
  normalizePageUrl,
  paginationNavNextStrategy,
  pathIncrementStrategy,
  queryPageStrategy,
  relNextStrategy,
} from "../../discovery/pagination/index.js";
import { rewriteBizBuySellToDesktopUrl } from "../bizbuysell-mobile.js";
import { discoverListingRefs } from "../bizbuysell.js";
import type { CatalogAdapter } from "../types.js";

export { isBizBuySellCatalogUrl };

export const BIZBUYSELL_CALIFORNIA_CATALOG_URL =
  "https://www.bizbuysell.com/california-businesses-for-sale/";

const PAGE_IN_PATH =
  /(?:^\/businesses-for-sale|-businesses-for-sale)\/(\d+)\/?$/i;

/** Catalog slug path, e.g. `/california-businesses-for-sale` or `/businesses-for-sale`. */
export function catalogSlugFromPathname(pathname: string): string | null {
  if (/^\/businesses-for-sale(?:\/\d+)?\/?$/i.test(pathname)) {
    return "/businesses-for-sale";
  }
  const m = pathname.match(/^(.*-businesses-for-sale)(?:\/\d+)?\/?$/i);
  return m?.[1] ?? null;
}

/** Page number from BBS path pagination (`/slug/` → 1, `/slug/2/` → 2). */
export function catalogPageNumberFromPathname(pathname: string): number {
  const m = pathname.match(PAGE_IN_PATH);
  if (m) {
    const pageRaw = m[1];
    if (pageRaw !== undefined) {
      const n = Number.parseInt(pageRaw, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  if (/-businesses-for-sale\/?$/i.test(pathname)) return 1;
  return 1;
}

export function buildCatalogPageUrl(base: URL, pageNum: number): string {
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return normalizePageUrl(base.toString());
  const u = new URL(base);
  u.pathname = pageNum <= 1 ? `${slug}/` : `${slug}/${pageNum}/`;
  u.search = "";
  return normalizePageUrl(u.toString());
}

/** Rebuild a catalog page URL when fetch `finalUrl` drifts (e.g. SPA → mobile home). */
export function recoverCatalogPageUrl(
  catalogBaseUrl: string,
  pageNumber: number,
): string {
  return buildCatalogPageUrl(new URL(catalogBaseUrl), pageNumber);
}

export type DiscoverNextBizBuySellOptions = {
  /** Canonical www catalog URL; used when `currentUrl` is not a catalog path. */
  catalogBaseUrl?: string;
  /** 1-based page index after fetch (matches `pagesFetched` in catalog walk). */
  currentPageNumber?: number;
};

const CATALOG_PATH = /-businesses-for-sale(?:\/\d+)?\/?$/i;

const bizBuySellPathPagination = pathIncrementStrategy({
  id: "bizbuysell-path",
  catalogPathPattern: CATALOG_PATH,
  pageFromPathname: catalogPageNumberFromPathname,
  pageFromLinkPathname: (pathname) => {
    const m = pathname.match(PAGE_IN_PATH);
    if (!m) return null;
    const pageRaw = m[1];
    if (pageRaw === undefined) return null;
    const n = Number.parseInt(pageRaw, 10);
    return Number.isNaN(n) ? null : n;
  },
  buildPageUrl: buildCatalogPageUrl,
});

const bizBuySellPagerLinkStrategy = linkSelectorNextStrategy({
  id: "bizbuysell-pager-href",
  selectors:
    "a.bbsPager_next[href], li.pagination-next:not(.disabled) a[href], a.next-page[href]",
});

/** Strategies for BizBuySell catalog/search index pages (order matters). */
export const bizBuySellCatalogPaginationStrategies: readonly PaginationStrategy[] =
  [
    relNextStrategy,
    bizBuySellPagerLinkStrategy,
    paginationNavNextStrategy,
    bizBuySellPathPagination,
    queryPageStrategy,
  ];

/** Highest `/slug/N/` page number mentioned in HTML (pager often loads late in Playwright). */
export function maxCatalogPageNumberInHtml(
  html: string,
  catalogSlug: string,
): number {
  const escaped = catalogSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}/(\\d+)/`, "gi");
  let max = 0;
  for (const m of html.matchAll(re)) {
    const pageRaw = m[1];
    if (pageRaw === undefined) continue;
    const n = Number.parseInt(pageRaw, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

function catalogHtmlHasPagerChrome(html: string): boolean {
  return /ngx-pagination|bbsPager|pagination-previous|pagination-next|aria-label=["']Pagination|class=["'][^"']*pagination/i.test(
    html,
  );
}

function catalogHtmlHasListingAnchors(html: string): boolean {
  return /business-opportunity\//i.test(html);
}

/** Canonical compare key so `/slug/` and `/slug/1/` are the same catalog page. */
export function normalizeCatalogUrlForCompare(url: string): string {
  const base = new URL(url);
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return normalizePageUrl(url);
  const queryPage = base.searchParams.get("page");
  const pageFromQuery = queryPage ? Number.parseInt(queryPage, 10) : Number.NaN;
  const page = !Number.isNaN(pageFromQuery)
    ? pageFromQuery
    : catalogPageNumberFromPathname(base.pathname);
  base.pathname = page <= 1 ? `${slug}/` : `${slug}/${page}/`;
  base.search = "";
  return normalizePageUrl(base.toString());
}

/** When anchor-based strategies miss the pager, infer next page from other page links in HTML. */
export function synthesizeNextCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const base = new URL(currentUrl);
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return null;
  const current = catalogPageNumberFromPathname(base.pathname);
  if (maxCatalogPageNumberInHtml(html, slug) > current) {
    return buildCatalogPageUrl(base, current + 1);
  }
  // Catalog index with listings: advance by path segment (stop walk on empty page).
  if (catalogHtmlHasListingAnchors(html)) {
    return buildCatalogPageUrl(base, current + 1);
  }
  if (catalogHtmlHasPagerChrome(html)) {
    return buildCatalogPageUrl(base, current + 1);
  }
  return null;
}

function urlForCatalogPagination(
  currentUrl: string,
  options?: DiscoverNextBizBuySellOptions,
): string {
  if (catalogSlugFromPathname(new URL(currentUrl).pathname)) {
    return currentUrl;
  }
  if (options?.catalogBaseUrl && options.currentPageNumber) {
    return recoverCatalogPageUrl(
      options.catalogBaseUrl,
      options.currentPageNumber,
    );
  }
  return currentUrl;
}

export function discoverNextBizBuySellCatalogPageUrl(
  html: string,
  currentUrl: string,
  options?: DiscoverNextBizBuySellOptions,
): string | null {
  const urlForPagination = urlForCatalogPagination(currentUrl, options);
  const fromStrategies = discoverNextPageUrl(
    html,
    urlForPagination,
    bizBuySellCatalogPaginationStrategies,
  );
  if (fromStrategies && isBizBuySellCatalogUrl(fromStrategies)) {
    const samePage =
      normalizeCatalogUrlForCompare(fromStrategies) ===
      normalizeCatalogUrlForCompare(urlForPagination);
    if (!samePage) return fromStrategies;
    // Keep legacy ?page= query pagination when path compare collides.
    if (fromStrategies.includes("page=")) return fromStrategies;
  }
  return synthesizeNextCatalogPageUrl(html, urlForPagination);
}

/** @deprecated Use {@link discoverNextBizBuySellCatalogPageUrl}. */
export const discoverNextCatalogPageUrl = discoverNextBizBuySellCatalogPageUrl;

function discoverBizBuySellListingRefsFromJsonLd(html: string): ListingRef[] {
  return discoverListingRefsFromJsonLd(html, {
    urlMatches: (url) => url.includes("bizbuysell"),
    normalizeUrl: rewriteBizBuySellToDesktopUrl,
    externalIdFromUrl: (url) => url.match(/(\d{6,})/)?.[1],
  });
}

/** Merge JSON-LD + anchor discovery for one catalog/search results page. */
export async function discoverListingRefsFromCatalogPage(
  html: string,
  pageUrl: string,
): Promise<ListingRef[]> {
  const merged = new Map<string, ListingRef>();
  for (const r of discoverBizBuySellListingRefsFromJsonLd(html)) {
    const ref = listingRefFromBizBuySellUrl(
      rewriteBizBuySellToDesktopUrl(r.url),
    );
    if (ref) mergeListingRefsIntoMap(merged, [ref]);
  }
  for await (const r of discoverListingRefs(html, pageUrl)) {
    const ref = listingRefFromBizBuySellUrl(
      rewriteBizBuySellToDesktopUrl(r.url),
    );
    if (ref) mergeListingRefsIntoMap(merged, [ref]);
  }
  return [...merged.values()];
}

export const bizBuySellCatalogAdapter: CatalogAdapter = {
  id: "bizbuysell",
  isCatalogUrl: isBizBuySellCatalogUrl,
  discoverListingRefsFromPage: discoverListingRefsFromCatalogPage,
  paginationStrategies: bizBuySellCatalogPaginationStrategies,
  discoverNextPage: discoverNextBizBuySellCatalogPageUrl,
};
