import type { ListingRef } from "@clearbolt/core";
import {
  CatalogPageBlockedError,
  detectCatalogPageBlock,
} from "../catalog-page-block.js";
import {
  isBizBuySellCatalogUrl,
  normalizeCatalogUrlForCompare as normalizeBizBuySellCatalogUrlForCompare,
  recoverCatalogPageUrl as recoverBizBuySellCatalogPageUrl,
} from "../adapters/bizbuysell/catalog.js";
import {
  countListingRefsNewOnPage,
  mergeListingRefByUrl,
  type MergeListingRef,
} from "./listing-ref-merge.js";

export type { MergeListingRef } from "./listing-ref-merge.js";

/** Human-readable duration for catalog progress logs. */
export function formatCatalogPageDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

export interface CatalogWalkProgress {
  phase: "discovery";
  message: string;
  current?: number;
  total?: number;
}

export interface WalkCatalogPagesOptions {
  startUrl: string;
  /**
   * Canonical catalog URL (usually www) for pagination when `finalUrl` drifts
   * off the catalog path (Playwright SPA / redirect to mobile home).
   */
  catalogBaseUrl?: string;
  /** 0 = no page cap (until no next). */
  maxPages: number;
  /** 0 = no listing cap. */
  maxListings: number;
  fetchPage: (
    url: string,
    ctx: { pageIndex: number; altUrl?: string },
  ) => Promise<{ body: string; finalUrl: string; status?: number }>;
  discoverRefs: (html: string, pageUrl: string) => Promise<ListingRef[]>;
  discoverNext: (
    html: string,
    pageUrl: string,
    pageNumber: number,
  ) => string | null;
  /** Log why pagination stopped (e.g. CLEARBOLT_SCRAPER_DEBUG). */
  onPaginationDecision?: (detail: {
    lastPageUrl: string;
    nextUrl: string | null;
    reason: string;
  }) => void;
  rewriteNextUrl?: (nextUrl: string) => string;
  /** Optional alternate URL for the first page only (e.g. www → mobile). */
  altUrlForFirstPage?: (url: string) => string | undefined;
  onProgress?: (progress: CatalogWalkProgress) => void;
  /** Appended to “Loading catalog page N…” messages. */
  fetchLaneLabel?: string;
  /** How to merge listing refs across pages (default: by URL). */
  mergeRef?: MergeListingRef;
  /**
   * Listing keys already known before this walk (e.g. prior ingest state).
   * Count toward “seen on page” for stale-page early stop.
   */
  seedKnownListingKeys?: ReadonlySet<string>;
  /**
   * Stop after this many consecutive catalog pages where every listing was
   * already seen (in `merged` or `seedKnownListingKeys`). 0 = disabled.
   */
  stalePagesToStop?: number;
  /** Pre-seed merged refs (resume after checkpoint). */
  initialRefs?: ListingRef[];
  /** Resume pagination from this URL instead of `startUrl`. */
  resumeFromUrl?: string;
  /** Pages already fetched before `resumeFromUrl` (progress only). */
  initialPagesFetched?: number;
  /** Called after each page is merged (checkpoint to disk). */
  onPageComplete?: (detail: {
    refs: ListingRef[];
    pagesFetched: number;
    lastPageUrl: string;
    nextPageUrl: string | null;
  }) => void | Promise<void>;
  /** Site-specific catalog URL check when fetch `finalUrl` drifts. */
  isCatalogUrl?: (url: string) => boolean;
  recoverCatalogPageUrl?: (catalogBaseUrl: string, pageNumber: number) => string;
  normalizeCatalogUrlForCompare?: (url: string) => string;
}

export interface CatalogWalkResult {
  refs: ListingRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}

/**
 * Fetch catalog/search pages in sequence, merge listing refs, follow pagination.
 * `mergeRef` only dedupes the in-memory ref list for discovery — it does not
 * write to `MetadataStore`; ingest still uses `ingestSourceRecord` + `DedupKeyer`.
 */
export async function walkCatalogPages(
  options: WalkCatalogPagesOptions,
): Promise<CatalogWalkResult> {
  const merged = new Map<string, ListingRef>();
  const mergeRef = options.mergeRef ?? mergeListingRefByUrl;
  if (options.initialRefs?.length) {
    for (const ref of options.initialRefs) {
      mergeRef(merged, ref);
    }
  }
  const stalePagesToStop = options.stalePagesToStop ?? 0;
  const isCatalogUrl = options.isCatalogUrl ?? isBizBuySellCatalogUrl;
  const recoverCatalogPageUrl =
    options.recoverCatalogPageUrl ?? recoverBizBuySellCatalogPageUrl;
  const normalizeCatalogUrlForCompare =
    options.normalizeCatalogUrlForCompare ??
    normalizeBizBuySellCatalogUrlForCompare;
  let consecutiveStalePages = 0;
  let url: string | null = options.resumeFromUrl ?? options.startUrl;
  let pagesFetched = options.initialPagesFetched ?? 0;
  let lastPageUrl = options.startUrl;
  let lastHtml = "";
  const lane = options.fetchLaneLabel ?? "";

  while (url) {
    if (options.maxPages > 0 && pagesFetched >= options.maxPages) break;

    const altUrl =
      pagesFetched === 0 && options.altUrlForFirstPage
        ? options.altUrlForFirstPage(url)
        : undefined;

    const pageNum = pagesFetched + 1;
    options.onProgress?.({
      phase: "discovery",
      message: `Loading catalog page ${pageNum}${lane}…`,
      current: pageNum,
      total: options.maxPages > 0 ? options.maxPages : undefined,
    });

    const pageStarted = performance.now();
    const fetchStarted = performance.now();
    const { body, finalUrl, status: pageStatus } = await options.fetchPage(url, {
      pageIndex: pagesFetched,
      altUrl,
    });
    const fetchMs = performance.now() - fetchStarted;
    pagesFetched++;
    const httpStatus = pageStatus ?? 200;
    const pageUrlForPagination =
      options.catalogBaseUrl && !isCatalogUrl(finalUrl)
        ? recoverCatalogPageUrl(options.catalogBaseUrl, pagesFetched)
        : finalUrl;
    if (pageUrlForPagination !== finalUrl) {
      options.onProgress?.({
        phase: "discovery",
        message: `Catalog URL recovered for pagination: ${pageUrlForPagination} (fetch landed on ${finalUrl})`,
      });
    }
    lastPageUrl = pageUrlForPagination;
    lastHtml = body;

    const parseStarted = performance.now();
    const pageRefs = await options.discoverRefs(body, lastPageUrl);
    const parseMs = performance.now() - parseStarted;
    const pageCounts = countListingRefsNewOnPage(merged, pageRefs, {
      seedKnownKeys: options.seedKnownListingKeys,
      mergeRef,
    });
    for (const ref of pageRefs) {
      mergeRef(merged, ref);
      if (options.maxListings > 0 && merged.size >= options.maxListings) break;
    }

    const samples = pageRefs
      .slice(0, 3)
      .map((r) => r.url)
      .join(" | ");
    const sampleSuffix = samples ? ` — e.g. ${samples}` : "";
    const pageMs = performance.now() - pageStarted;
    const staleSuffix =
      pageCounts.total > 0 && pageCounts.newOnPage === 0
        ? " — all listings already seen on prior page(s)"
        : "";
    options.onProgress?.({
      phase: "discovery",
      message:
        `Page ${pagesFetched}: ${pageRefs.length} listing link(s) on page (${merged.size} unique listings, ` +
        `${pageCounts.newOnPage} new on page) ` +
        `in ${formatCatalogPageDuration(pageMs)} ` +
        `(fetch ${formatCatalogPageDuration(fetchMs)}, parse ${formatCatalogPageDuration(parseMs)})${sampleSuffix}${staleSuffix}`,
      current: pagesFetched,
    });

    if (
      stalePagesToStop > 0 &&
      pageCounts.total > 0 &&
      pageCounts.newOnPage === 0
    ) {
      consecutiveStalePages++;
      if (consecutiveStalePages >= stalePagesToStop) {
        options.onPaginationDecision?.({
          lastPageUrl,
          nextUrl: null,
          reason: `${consecutiveStalePages} consecutive catalog page(s) with only previously seen listings`,
        });
        break;
      }
    } else {
      consecutiveStalePages = 0;
    }

    if (options.maxListings > 0 && merged.size >= options.maxListings) break;

    if (pageRefs.length === 0 && httpStatus !== 0) {
      const block = detectCatalogPageBlock(httpStatus, body);
      if (block) {
        throw new CatalogPageBlockedError(
          `${block.message} (${lastPageUrl})`,
          block,
          lastPageUrl,
          httpStatus,
        );
      }
    }

    if (httpStatus === 0 && body.length === 0) {
      options.onPaginationDecision?.({
        lastPageUrl,
        nextUrl: null,
        reason: "browser window closed during fetch",
      });
      break;
    }

    if (pagesFetched > 0 && pageRefs.length === 0) {
      options.onPaginationDecision?.({
        lastPageUrl,
        nextUrl: null,
        reason: "empty listing page",
      });
      break;
    }

    const next = options.discoverNext(body, lastPageUrl, pagesFetched);
    const rewritten = next
      ? options.rewriteNextUrl
        ? options.rewriteNextUrl(next)
        : next
      : null;
    const nextPageUrl =
      rewritten &&
      normalizeCatalogUrlForCompare(rewritten) !==
        normalizeCatalogUrlForCompare(lastPageUrl)
        ? rewritten
        : null;

    await options.onPageComplete?.({
      refs: [...merged.values()],
      pagesFetched,
      lastPageUrl,
      nextPageUrl,
    });

    if (!nextPageUrl) {
      options.onPaginationDecision?.({
        lastPageUrl,
        nextUrl: rewritten,
        reason: rewritten ? "next same as current" : "no next page",
      });
      break;
    }
    url = nextPageUrl;
  }

  return {
    refs: [...merged.values()],
    pagesFetched,
    lastPageUrl,
    lastHtml,
  };
}
