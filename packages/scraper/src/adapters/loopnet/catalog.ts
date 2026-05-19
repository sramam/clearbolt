import type { ListingRef } from "@clearbolt/core";
import * as cheerio from "cheerio";
import { mergeListingRefsIntoMap } from "../../discovery/listing-ref-merge.js";
import {
  type PaginationStrategy,
  discoverNextPageUrl,
  linkSelectorNextStrategy,
  normalizePageUrl,
  paginationNavNextStrategy,
  pathIncrementStrategy,
  relNextStrategy,
} from "../../discovery/pagination/index.js";
import {
  isLoopNetCatalogUrl,
  listingRefFromLoopNetUrl,
} from "../../loopnet-listing-url.js";
import type { CatalogAdapter } from "../types.js";

export {
  isLoopNetCatalogUrl,
  LOOPNET_CALIFORNIA_CATALOG_URL,
} from "../../loopnet-listing-url.js";

const CATALOG_PATH =
  /\/biz\/(?:[^/]+\/[^/]*businesses[^/]*|[^/]*businesses(?:-for-sale)?)(?:\/+\d+)?\/?$/i;

/** `/biz/{slug}` or `/biz/{geo}/{slug}` without trailing page segment. */
export function catalogSlugFromPathname(pathname: string): string | null {
  const parts = pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "biz") return null;
  const last = parts[parts.length - 1];
  if (!last) return null;
  if (/^\d+$/.test(last)) parts.pop();
  if (parts.length === 2) {
    const slug = parts[1];
    if (!slug) return null;
    if (/businesses/i.test(slug)) return `/biz/${slug}`;
    return null;
  }
  if (parts.length === 3) {
    return `/biz/${parts[1]}/${parts[2]}`;
  }
  return null;
}

export function catalogPageNumberFromPathname(pathname: string): number {
  const parts = pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "biz") return 1;
  const last = parts[parts.length - 1];
  if (!last) return 1;
  const n = Number.parseInt(last, 10);
  if (!Number.isNaN(n) && n >= 1 && /^\d+$/.test(last)) return n;
  return 1;
}

export function buildLoopNetCatalogPageUrl(
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

export function recoverLoopNetCatalogPageUrl(
  catalogBaseUrl: string,
  pageNumber: number,
): string {
  return buildLoopNetCatalogPageUrl(catalogBaseUrl, pageNumber);
}

export function normalizeLoopNetCatalogUrlForCompare(url: string): string {
  const base = new URL(url);
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return normalizePageUrl(url);
  const page = catalogPageNumberFromPathname(base.pathname);
  base.pathname = page <= 1 ? `${slug}/` : `${slug}/${page}/`;
  base.search = "";
  base.hash = "";
  return normalizePageUrl(base.toString());
}

const loopNetPathPagination = pathIncrementStrategy({
  id: "loopnet-path",
  catalogPathPattern: CATALOG_PATH,
  pageFromPathname: catalogPageNumberFromPathname,
  pageFromLinkPathname: (pathname) => {
    if (!catalogSlugFromPathname(pathname)) return null;
    const page = catalogPageNumberFromPathname(pathname);
    return page >= 1 ? page : null;
  },
  buildPageUrl: (base, nextPage) =>
    buildLoopNetCatalogPageUrl(base.toString(), nextPage),
});

const loopNetPagerLinkStrategy = linkSelectorNextStrategy({
  id: "loopnet-pager-href",
  selectors:
    "a[rel='next'][href], li.pagination-next:not(.disabled) a[href], a.next-page[href], a[aria-label*='Next'][href]",
});

export const loopNetCatalogPaginationStrategies: readonly PaginationStrategy[] =
  [
    relNextStrategy,
    loopNetPagerLinkStrategy,
    paginationNavNextStrategy,
    loopNetPathPagination,
  ];

function maxCatalogPageNumberInHtml(html: string, catalogSlug: string): number {
  const escaped = catalogSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** Angular SPA pager hrefs include a double slash: `…/slug//2/`. */
  const re = new RegExp(`${escaped}/+(\\d+)/`, "gi");
  let max = 0;
  for (const m of html.matchAll(re)) {
    const pageRaw = m[1];
    if (pageRaw === undefined) continue;
    const n = Number.parseInt(pageRaw, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

function catalogHtmlHasListingAnchors(html: string): boolean {
  return /(?:\/Listing\/[^/]+\/\d+|\/biz\/business-(?:opportunity|for-sale)\/[^/]+\/\d+)/i.test(
    html,
  );
}

export function synthesizeNextLoopNetCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const base = new URL(currentUrl);
  const slug = catalogSlugFromPathname(base.pathname);
  if (!slug) return null;
  const current = catalogPageNumberFromPathname(base.pathname);
  if (maxCatalogPageNumberInHtml(html, slug) > current) {
    return buildLoopNetCatalogPageUrl(currentUrl, current + 1);
  }
  if (catalogHtmlHasListingAnchors(html)) {
    return buildLoopNetCatalogPageUrl(currentUrl, current + 1);
  }
  return null;
}

export function discoverNextLoopNetCatalogPageUrl(
  html: string,
  currentUrl: string,
): string | null {
  const fromStrategies = discoverNextPageUrl(
    html,
    currentUrl,
    loopNetCatalogPaginationStrategies,
  );
  if (fromStrategies && isLoopNetCatalogUrl(fromStrategies)) {
    /**
     * The Angular SPA emits pager hrefs with a double slash
     * (`…/california-businesses-for-sale//2/`). Canonicalize to the single-
     * slash form the rest of the pipeline expects.
     */
    const canonical = normalizeLoopNetCatalogUrlForCompare(fromStrategies);
    const samePage =
      canonical === normalizeLoopNetCatalogUrlForCompare(currentUrl);
    if (!samePage) return canonical;
  }
  return synthesizeNextLoopNetCatalogPageUrl(html, currentUrl);
}

export async function discoverListingRefsFromLoopNetCatalogPage(
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
      const ref = listingRefFromLoopNetUrl(abs);
      if (ref) mergeListingRefsIntoMap(merged, [ref]);
    } catch {
      /* ignore bad href */
    }
  });

  return [...merged.values()];
}

export const loopNetCatalogAdapter: CatalogAdapter = {
  id: "loopnet",
  isCatalogUrl: isLoopNetCatalogUrl,
  discoverListingRefsFromPage: discoverListingRefsFromLoopNetCatalogPage,
  paginationStrategies: loopNetCatalogPaginationStrategies,
  discoverNextPage: discoverNextLoopNetCatalogPageUrl,
};
