import type { ListingRef } from "@clearbolt/core";
import type { EvidenceStore, MetadataStore } from "@clearbolt/storage";
import {
  businessesForSaleCatalogAdapter,
  discoverNextBusinessesForSaleCatalogPageUrl,
  isBusinessesForSaleCatalogUrl,
  normalizeBusinessesForSaleCatalogUrlForCompare,
  recoverBusinessesForSaleCatalogPageUrl,
} from "./adapters/businessesforsale/catalog.js";
import type { ResumeCatalogDiscovery } from "./bizbuysell-catalog-scrape-pipeline.js";
import { catalogPageGapMs } from "./bizbuysell-run-policy.js";
import { writeCatalogRefsFile } from "./catalog-refs-file.js";
import { walkCatalogPages } from "./discovery/catalog-walk.js";
import { mergeListingRefByExternalId } from "./discovery/listing-ref-merge.js";
import type { Fetcher } from "./fetcher.js";
import { HttpFetcher } from "./http-fetcher.js";
import { catalogStalePagesToStop } from "./listing-ingest-state.js";
import { throttleHost } from "./throttle.js";

export type { ResumeCatalogDiscovery };

export interface RunBusinessesForSaleCatalogScrapeOptions {
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
  /** Playwright fetcher (required for live pages; Cloudflare blocks plain HTTP). */
  browserFetcher?: Fetcher;
  onProgress?: (ev: {
    phase: "discovery";
    message: string;
    current?: number;
    total?: number;
  }) => void;
}

export interface RunBusinessesForSaleCatalogScrapeResult {
  pagesFetched: number;
  listingsDiscovered: number;
  catalogUrl: string;
  discoveredListingUrls?: string[];
  discoveredListingRefs?: ListingRef[];
  searchEvidenceKey: string;
}

const BUSINESSES_FOR_SALE_ADAPTER_ID = "businessesforsale";

function defaultMaxPages(): number {
  const raw = process.env.CLEARBOLT_CATALOG_MAX_PAGES;
  if (raw === undefined || raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

async function collectRefsFromCatalog(
  fetcher: Fetcher,
  startUrl: string,
  options: RunBusinessesForSaleCatalogScrapeOptions,
): Promise<{
  refs: ListingRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}> {
  const adapter = businessesForSaleCatalogAdapter;
  const pageGapMs = catalogPageGapMs();
  const stalePagesToStop = options.refreshCatalog
    ? 0
    : catalogStalePagesToStop();
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
    isCatalogUrl: isBusinessesForSaleCatalogUrl,
    recoverCatalogPageUrl: recoverBusinessesForSaleCatalogPageUrl,
    normalizeCatalogUrlForCompare:
      normalizeBusinessesForSaleCatalogUrlForCompare,
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
      discoverNextBusinessesForSaleCatalogPageUrl(html, pageUrl),
    onPaginationDecision: ({ lastPageUrl, nextUrl, reason }) => {
      options.onProgress?.({
        phase: "discovery",
        message: nextUrl
          ? `Next catalog page: ${nextUrl}`
          : `Pagination stopped: ${reason} (at ${lastPageUrl})`,
      });
    },
    onPageComplete:
      checkpointPath && options.catalogUrl
        ? async ({ refs, pagesFetched, lastPageUrl, nextPageUrl }) => {
            await writeCatalogRefsFile(checkpointPath, {
              adapter: BUSINESSES_FOR_SALE_ADAPTER_ID,
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

export async function runBusinessesForSaleCatalogScrape(
  options: RunBusinessesForSaleCatalogScrapeOptions,
): Promise<RunBusinessesForSaleCatalogScrapeResult> {
  const catalogUrl = options.catalogUrl.trim();
  if (!isBusinessesForSaleCatalogUrl(catalogUrl)) {
    throw new Error(
      `Not a BusinessesForSale catalog URL (expected /us/search/{region-or-slug}): ${catalogUrl}`,
    );
  }

  const fetcher = options.browserFetcher ?? new HttpFetcher();
  if (!options.browserFetcher) {
    throw new Error(
      "BusinessesForSale catalog requires Playwright (Cloudflare). Unset CLEARBOLT_SKIP_BROWSER=1 and run pnpm ensure:playwright.",
    );
  }

  let refs: ListingRef[];
  let pagesFetched: number;
  let lastPageUrl: string;
  let lastHtml: string;

  const skipCatalogWalk =
    options.listingRefs?.length && !options.resumeCatalogDiscovery;
  if (skipCatalogWalk) {
    refs = options.listingRefs ?? [];
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

  const searchRef = await options.evidence.put(Buffer.from(lastHtml, "utf8"), {
    adapter: BUSINESSES_FOR_SALE_ADAPTER_ID,
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
