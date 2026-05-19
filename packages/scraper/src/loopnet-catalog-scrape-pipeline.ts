import type { ListingRef } from "@clearbolt/core";
import type { EvidenceStore, MetadataStore } from "@clearbolt/storage";
import {
  discoverNextLoopNetCatalogPageUrl,
  isLoopNetCatalogUrl,
  loopNetCatalogAdapter,
  normalizeLoopNetCatalogUrlForCompare,
  recoverLoopNetCatalogPageUrl,
} from "./adapters/loopnet/catalog.js";
import { writeCatalogRefsFile } from "./catalog-refs-file.js";
import { walkCatalogPages } from "./discovery/catalog-walk.js";
import { mergeListingRefByExternalId } from "./discovery/listing-ref-merge.js";
import type { Fetcher } from "./fetcher.js";
import { HttpFetcher } from "./http-fetcher.js";
import { catalogPageGapMs } from "./bizbuysell-run-policy.js";
import { catalogStalePagesToStop } from "./listing-ingest-state.js";
import { throttleHost } from "./throttle.js";
import type { ResumeCatalogDiscovery } from "./bizbuysell-catalog-scrape-pipeline.js";

export type { ResumeCatalogDiscovery };

export interface RunLoopNetCatalogScrapeOptions {
  catalogUrl: string;
  evidence: EvidenceStore;
  metadata: MetadataStore;
  maxPages?: number;
  maxListings?: number;
  discoverOnly?: boolean;
  listingRefs?: ListingRef[];
  refreshCatalog?: boolean;
  resumeCatalogDiscovery?: ResumeCatalogDiscovery;
  catalogRefsCheckpointPath?: string;
  /** Playwright fetcher (required for live LoopNet; Akamai blocks plain HTTP). */
  browserFetcher?: Fetcher;
  onProgress?: (ev: {
    phase: "discovery";
    message: string;
    current?: number;
    total?: number;
  }) => void;
}

export interface RunLoopNetCatalogScrapeResult {
  pagesFetched: number;
  listingsDiscovered: number;
  catalogUrl: string;
  discoveredListingUrls?: string[];
  discoveredListingRefs?: ListingRef[];
  searchEvidenceKey: string;
}

const LOOPNET_ADAPTER_ID = "loopnet";

function defaultMaxPages(): number {
  const raw = process.env.CLEARBOLT_CATALOG_MAX_PAGES;
  if (raw === undefined || raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

async function collectRefsFromCatalog(
  fetcher: Fetcher,
  startUrl: string,
  options: RunLoopNetCatalogScrapeOptions,
): Promise<{
  refs: ListingRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}> {
  const adapter = loopNetCatalogAdapter;
  const pageGapMs = catalogPageGapMs();
  const stalePagesToStop = options.refreshCatalog ? 0 : catalogStalePagesToStop();
  const resume = options.resumeCatalogDiscovery;
  const checkpointPath = options.catalogRefsCheckpointPath;

  return walkCatalogPages({
    startUrl,
    resumeFromUrl: resume?.startUrl,
    initialRefs: resume?.refs,
    initialPagesFetched: resume?.pagesFetched,
    catalogBaseUrl: options.catalogUrl,
    maxPages: options.maxPages ?? defaultMaxPages(),
    maxListings: options.maxListings ?? 0,
    mergeRef: mergeListingRefByExternalId,
    stalePagesToStop,
    isCatalogUrl: isLoopNetCatalogUrl,
    recoverCatalogPageUrl: recoverLoopNetCatalogPageUrl,
    normalizeCatalogUrlForCompare: normalizeLoopNetCatalogUrlForCompare,
    fetchLaneLabel: options.browserFetcher ? " (Playwright)" : "",
    onProgress: options.onProgress,
    fetchPage: async (url, ctx) => {
      if (ctx.pageIndex > 0 && pageGapMs > 0) {
        await throttleHost(new URL(url).hostname, pageGapMs);
      }
      const res = await fetcher.fetch({ url });
      return {
        body: res.body,
        finalUrl: res.finalUrl || url,
        status: res.status,
      };
    },
    discoverRefs: (html, pageUrl) =>
      adapter.discoverListingRefsFromPage(html, pageUrl),
    discoverNext: (html, pageUrl) =>
      discoverNextLoopNetCatalogPageUrl(html, pageUrl),
    onPaginationDecision: ({ lastPageUrl, nextUrl, reason }) => {
      if (nextUrl) {
        options.onProgress?.({
          phase: "discovery",
          message: `Next catalog page: ${nextUrl}`,
        });
      } else {
        options.onProgress?.({
          phase: "discovery",
          message: `Pagination stopped: ${reason} (at ${lastPageUrl})`,
        });
      }
    },
    onPageComplete:
      checkpointPath && options.catalogUrl
        ? async ({ refs, pagesFetched, lastPageUrl, nextPageUrl }) => {
            await writeCatalogRefsFile(checkpointPath, {
              adapter: LOOPNET_ADAPTER_ID,
              catalogUrl: options.catalogUrl,
              refs,
              complete: !nextPageUrl,
              pagesFetched,
              lastPageUrl,
              nextPageUrl: nextPageUrl ?? undefined,
            });
          }
        : undefined,
  });
}

export async function runLoopNetCatalogScrape(
  options: RunLoopNetCatalogScrapeOptions,
): Promise<RunLoopNetCatalogScrapeResult> {
  const catalogUrl = options.catalogUrl.trim();
  if (!isLoopNetCatalogUrl(catalogUrl)) {
    throw new Error(
      `Not a LoopNet biz catalog URL (expected /biz/{geo}/{…businesses…}/): ${catalogUrl}`,
    );
  }

  if (!options.discoverOnly && !options.listingRefs?.length) {
    throw new Error(
      "LoopNet listing ingest is not implemented yet. Use --discover-only or wait for the V1 adapter.",
    );
  }

  const fetcher = options.browserFetcher ?? new HttpFetcher();
  if (!options.browserFetcher) {
    console.warn(
      "LoopNet catalog: no browser fetcher — plain HTTP often returns Akamai 403. Use Playwright (default via runLoopNetCatalogScrapeWithBrowser).",
    );
  }

  let refs: ListingRef[];
  let pagesFetched: number;
  let lastPageUrl: string;
  let lastHtml: string;

  const skipCatalogWalk =
    options.listingRefs?.length && !options.resumeCatalogDiscovery;
  if (skipCatalogWalk) {
    refs = options.listingRefs!;
    pagesFetched = 0;
    lastPageUrl = catalogUrl;
    lastHtml = "";
    options.onProgress?.({
      phase: "discovery",
      message: `Using ${refs.length} listing ref(s) from file (catalog walk skipped)`,
    });
  } else {
    const walked = await collectRefsFromCatalog(fetcher, catalogUrl, options);
    refs = walked.refs;
    pagesFetched = walked.pagesFetched;
    lastPageUrl = walked.lastPageUrl;
    lastHtml = walked.lastHtml;
  }

  const searchBuf = Buffer.from(lastHtml, "utf8");
  const searchRef = await options.evidence.put(searchBuf, {
    adapter: LOOPNET_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: lastPageUrl,
  });

  options.onProgress?.({
    phase: "discovery",
    message: `Discovery complete: ${refs.length} unique listing URL(s) from ${pagesFetched} catalog page(s)`,
  });

  return {
    pagesFetched,
    listingsDiscovered: refs.length,
    catalogUrl,
    discoveredListingUrls: refs.map((r) => r.url),
    discoveredListingRefs: refs,
    searchEvidenceKey: searchRef.key,
  };
}
