import {
  type PaginationStrategy,
  linkSelectorNextStrategy,
  normalizePageUrl,
  paginationNavNextStrategy,
  queryPageStrategy,
  relNextStrategy,
} from "@clearbolt/scraper";
import * as cheerio from "cheerio";

/** WordPress-style `?paged=N` (common on broker WordPress sites). */
const queryPagedStrategy: PaginationStrategy = {
  id: "query-paged",
  findNext(html, currentUrl) {
    const base = new URL(currentUrl);
    const current = Number.parseInt(
      base.searchParams.get("paged") ?? base.searchParams.get("page") ?? "1",
      10,
    );
    const next = current + 1;
    const $ = cheerio.load(html);
    let found = false;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const u = new URL(href, base);
        const p = u.searchParams.get("paged") ?? u.searchParams.get("page");
        if (p && Number.parseInt(p, 10) === next) found = true;
      } catch {
        /* skip */
      }
    });
    if (
      !found &&
      !html.includes(`paged=${next}`) &&
      !html.includes(`page=${next}`)
    ) {
      return null;
    }
    const u = new URL(base);
    if (base.searchParams.has("paged") || html.includes("paged=")) {
      u.searchParams.set("paged", String(next));
    } else {
      u.searchParams.set("page", String(next));
    }
    return normalizePageUrl(u.toString());
  },
};

const brokerPagerLinks = linkSelectorNextStrategy({
  id: "broker-pager-href",
  selectors:
    "a.page-numbers.next[href], a.pagination__next[href], .pagination a.next[href], a[rel='next'][href]",
});

/** Strategies for broker-owned listing index pages (order matters). */
export const brokerSitePaginationStrategies: readonly PaginationStrategy[] = [
  relNextStrategy,
  brokerPagerLinks,
  paginationNavNextStrategy,
  queryPagedStrategy,
  queryPageStrategy,
];

export type BrokerSitePaginationResult = {
  nextUrl: string | null;
  strategyId: string | null;
};

export function discoverNextBrokerSiteIndexPageUrl(
  html: string,
  currentUrl: string,
): BrokerSitePaginationResult {
  for (const strategy of brokerSitePaginationStrategies) {
    const next = strategy.findNext(html, currentUrl);
    if (next) {
      return { nextUrl: next, strategyId: strategy.id };
    }
  }
  return { nextUrl: null, strategyId: null };
}
