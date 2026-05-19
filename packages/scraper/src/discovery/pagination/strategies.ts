import * as cheerio from "cheerio";
import { normalizePageUrl } from "./normalize.js";
import type { PaginationStrategy } from "./types.js";

function resolveHref(base: URL, href: string): string {
  return normalizePageUrl(new URL(href, base).toString());
}

/** `<link rel="next">` / `<a rel="next">`. */
export const relNextStrategy: PaginationStrategy = {
  id: "rel-next",
  findNext(html, currentUrl) {
    const $ = cheerio.load(html);
    const base = new URL(currentUrl);
    const href =
      $('link[rel="next"]').attr("href") ?? $('a[rel="next"]').attr("href");
    if (!href) return null;
    return resolveHref(base, href);
  },
};

export type LinkSelectorNextOptions = {
  id?: string;
  /** Cheerio selector for next links that include href. */
  selectors: string;
};

/** Next link found via CSS selectors (site-specific lists go in adapter config). */
export function linkSelectorNextStrategy(
  options: LinkSelectorNextOptions,
): PaginationStrategy {
  return {
    id: options.id ?? "link-selector-next",
    findNext(html, currentUrl) {
      const $ = cheerio.load(html);
      const base = new URL(currentUrl);
      const href = $(options.selectors).first().attr("href");
      if (!href || href.startsWith("#")) return null;
      return resolveHref(base, href);
    },
  };
}

/** Pagination nav: disabled-next skip, “Next” text/aria, optional class substring. */
export const paginationNavNextStrategy: PaginationStrategy = {
  id: "pagination-nav-next",
  findNext(html, currentUrl) {
    const $ = cheerio.load(html);
    const base = new URL(currentUrl);

    const navHref = $(
      "li.pagination-next:not(.disabled) a[href], a.next-page[href]",
    )
      .first()
      .attr("href");
    if (navHref && !navHref.startsWith("#")) {
      return resolveHref(base, navHref);
    }

    let explicitNext: string | undefined;
    $("a[href]").each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      const aria = ($(el).attr("aria-label") ?? "").trim().toLowerCase();
      const cls = ($(el).attr("class") ?? "").toLowerCase();
      if (
        text === "next" ||
        text === "›" ||
        text === "»" ||
        aria === "next" ||
        aria.includes("next page")
      ) {
        const href = $(el).attr("href");
        if (href && !href.startsWith("#")) {
          explicitNext = href;
          return false;
        }
      }
      if (cls.includes("pager_next") || cls.includes("bbspager_next")) {
        const href = $(el).attr("href");
        if (href && !href.startsWith("#")) {
          explicitNext = href;
          return false;
        }
      }
      return undefined;
    });
    if (explicitNext) return resolveHref(base, explicitNext);
    return null;
  },
};

export type PathIncrementOptions = {
  id?: string;
  /** Current URL pathname must match to apply this strategy. */
  catalogPathPattern: RegExp;
  pageFromPathname: (pathname: string) => number;
  pageFromLinkPathname: (pathname: string) => number | null;
  buildPageUrl: (base: URL, pageNum: number) => string;
};

/**
 * Path-segment pagination (e.g. `/catalog/2/`). Adapter supplies slug/page patterns.
 */
export function pathIncrementStrategy(
  options: PathIncrementOptions,
): PaginationStrategy {
  return {
    id: options.id ?? "path-increment",
    findNext(html, currentUrl) {
      const base = new URL(currentUrl);
      if (!options.catalogPathPattern.test(base.pathname)) return null;

      const $ = cheerio.load(html);
      const currentPage = options.pageFromPathname(base.pathname);
      const nextPage = currentPage + 1;
      let pathNext: string | null = null;
      const pageNums = new Set<number>();

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const u = new URL(href, base);
          const n = options.pageFromLinkPathname(u.pathname);
          if (n !== null) {
            pageNums.add(n);
            if (n === nextPage) {
              pathNext = u.toString();
              return false;
            }
          }
        } catch {
          /* ignore */
        }
        return undefined;
      });

      if (pathNext) return normalizePageUrl(pathNext);
      if (pageNums.has(nextPage)) {
        return options.buildPageUrl(base, nextPage);
      }
      return null;
    },
  };
}

/** `?page=N` query pagination. */
export const queryPageStrategy: PaginationStrategy = {
  id: "query-page",
  findNext(html, currentUrl) {
    const $ = cheerio.load(html);
    const base = new URL(currentUrl);
    const queryCurrent = Number.parseInt(
      base.searchParams.get("page") ?? "1",
      10,
    );
    const candidatePages = new Set<number>();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const u = new URL(href, base);
        const p = u.searchParams.get("page");
        if (p) {
          const n = Number.parseInt(p, 10);
          if (!Number.isNaN(n)) candidatePages.add(n);
        }
      } catch {
        /* ignore */
      }
    });

    const nextQueryPage = queryCurrent + 1;
    if (candidatePages.has(nextQueryPage)) {
      const u = new URL(base);
      u.searchParams.set("page", String(nextQueryPage));
      return normalizePageUrl(u.toString());
    }

    if (
      html.includes(`page=${nextQueryPage}`) ||
      html.includes(`page=${nextQueryPage}&`)
    ) {
      const u = new URL(base);
      u.searchParams.set("page", String(nextQueryPage));
      return normalizePageUrl(u.toString());
    }

    return null;
  },
};
