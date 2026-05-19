import type { ListingRef, SourceRecord } from "@clearbolt/core";
import type { IngestSourceResult } from "@clearbolt/dedup";
import type {
  EvidenceStore,
  MetadataStore,
  ProcessedArtifactStore,
} from "@clearbolt/storage";
import type { ResumeCatalogDiscovery } from "./bizbuysell-catalog-scrape-pipeline.js";
import {
  catalogSourceForUrl,
  type CatalogSourceId,
} from "./catalog-source-registry.js";
import { runBizBuySellCatalogScrapeWithBrowser } from "./run-bizbuysell-catalog-scrape.js";
import { runBusinessBrokerCatalogScrape } from "./run-businessbroker-catalog-scrape.js";
import { runBusinessesForSaleCatalogScrapeWithBrowser } from "./run-businessesforsale-catalog-scrape.js";
import { runDealStreamCatalogScrapeWithBrowser } from "./run-dealstream-catalog-scrape.js";
import { runLoopNetCatalogScrapeWithBrowser } from "./run-loopnet-catalog-scrape.js";
import { shouldUseBrowserFirstForBizBuySell } from "./bizbuysell-run-policy.js";

export type CatalogScrapeProgress = {
  phase: "discovery" | "fetch" | "process" | "ingest" | "dedup";
  message: string;
  current?: number;
  total?: number;
};

export type CatalogScrapeRunOptions = {
  catalogUrl: string;
  evidence: EvidenceStore;
  metadata: MetadataStore;
  processedArtifacts: ProcessedArtifactStore;
  listingIngestState?: import("./listing-ingest-state.js").ListingIngestStateStore;
  ingestFailuresPath?: string;
  prioritizeIngestFailures?: boolean;
  discoverOnly?: boolean;
  maxPages?: number;
  maxListings?: number;
  ingestLimit?: number;
  listingRefs?: ListingRef[];
  refreshCatalog?: boolean;
  resumeCatalogDiscovery?: ResumeCatalogDiscovery;
  catalogRefsCheckpointPath?: string;
  useFixtures?: boolean;
  skipBrowser?: boolean;
  headed?: boolean;
  dedupEmbed?: boolean;
  onProgress?: (ev: CatalogScrapeProgress) => void;
  onIngested?: (args: {
    record: SourceRecord;
    result: IngestSourceResult;
  }) => void;
};

export type CatalogIngestOverallCounts = {
  ingested: number;
  failed: number;
  skippedKnown: number;
  skippedFresh: number;
  satisfied: number;
};

export type CatalogScrapeRunResult = {
  adapter: CatalogSourceId;
  catalogUrl: string;
  pagesFetched: number;
  listingsDiscovered: number;
  listingsIngested: number;
  listingsFailed: number;
  listingsSkippedKnown: number;
  listingsSkippedFresh: number;
  canonicalIds: string[];
  discoveredListingRefs?: ListingRef[];
  discoveredListingUrls?: string[];
  searchEvidenceKey: string;
  /** Totals from `listing-ingest-state` on disk after the run (when provided). */
  overall?: CatalogIngestOverallCounts;
};

/** Validate ingest is allowed for this source before running. */
export function assertCatalogIngestSupported(
  catalogUrl: string,
  discoverOnly: boolean | undefined,
  refsFile: boolean,
): void {
  const source = catalogSourceForUrl(catalogUrl);
  if (!discoverOnly && !refsFile && !source.ingestSupported) {
    throw new Error(
      `${source.label} catalog ingest is not implemented yet. Pass --discover-only (or --refs-file when ingest ships).`,
    );
  }
}

/**
 * Single entrypoint for all marketplace catalog crawlers.
 * Dispatches by adapter id derived from `catalogUrl`.
 */
export async function runCatalogScrape(
  options: CatalogScrapeRunOptions,
): Promise<CatalogScrapeRunResult> {
  const source = catalogSourceForUrl(options.catalogUrl);
  const discoverOnly = options.discoverOnly ?? false;
  const onProgress = options.onProgress;

  if (
    source.id === "bizbuysell" &&
    !discoverOnly &&
    !options.useFixtures &&
    shouldUseBrowserFirstForBizBuySell()
  ) {
    console.warn(
      "Tip: BizBuySell catalog discovery is more stable with HTTP+residential proxy. " +
        "Unset CLEARBOLT_BIZBUYSELL_BROWSER_FIRST (Playwright is still used for listing ingest when needed).",
    );
  }

  if (source.id === "businessesforsale") {
    const result = await runBusinessesForSaleCatalogScrapeWithBrowser({
      catalogUrl: options.catalogUrl,
      evidence: options.evidence,
      metadata: options.metadata,
      discoverOnly: true,
      skipBrowser: options.skipBrowser,
      headed: options.headed,
      maxPages: options.maxPages,
      maxListings: options.maxListings,
      listingRefs: options.listingRefs,
      resumeCatalogDiscovery: options.resumeCatalogDiscovery,
      catalogRefsCheckpointPath: options.catalogRefsCheckpointPath,
      refreshCatalog: options.refreshCatalog,
      onProgress,
    });
    return mapResult(source.id, options.catalogUrl, result);
  }

  if (source.id === "loopnet") {
    const result = await runLoopNetCatalogScrapeWithBrowser({
      catalogUrl: options.catalogUrl,
      evidence: options.evidence,
      metadata: options.metadata,
      discoverOnly: true,
      skipBrowser: options.skipBrowser,
      headed: options.headed,
      maxPages: options.maxPages,
      maxListings: options.maxListings,
      listingRefs: options.listingRefs,
      resumeCatalogDiscovery: options.resumeCatalogDiscovery,
      catalogRefsCheckpointPath: options.catalogRefsCheckpointPath,
      refreshCatalog: options.refreshCatalog,
      onProgress,
    });
    return mapResult(source.id, options.catalogUrl, result);
  }

  if (source.id === "dealstream") {
    const result = await runDealStreamCatalogScrapeWithBrowser({
      catalogUrl: options.catalogUrl,
      evidence: options.evidence,
      processedArtifacts: options.processedArtifacts,
      metadata: options.metadata,
      discoverOnly,
      skipBrowser: options.skipBrowser,
      headed: options.headed,
      maxPages: options.maxPages,
      maxListings: options.maxListings,
      ingestLimit: discoverOnly ? 0 : options.ingestLimit,
      listingRefs: options.listingRefs,
      resumeCatalogDiscovery: options.resumeCatalogDiscovery,
      catalogRefsCheckpointPath: options.catalogRefsCheckpointPath,
      refreshCatalog: options.refreshCatalog,
      onProgress,
      onIngested: options.onIngested,
    });
    return mapResult(source.id, options.catalogUrl, result);
  }

  if (source.id === "businessbroker") {
    const result = await runBusinessBrokerCatalogScrape({
      catalogUrl: options.catalogUrl,
      evidence: options.evidence,
      processedArtifacts: options.processedArtifacts,
      metadata: options.metadata,
      discoverOnly,
      maxPages: options.maxPages,
      maxListings: options.maxListings,
      ingestLimit: discoverOnly ? 0 : options.ingestLimit,
      listingRefs: options.listingRefs,
      resumeCatalogDiscovery: options.resumeCatalogDiscovery,
      catalogRefsCheckpointPath: options.catalogRefsCheckpointPath,
      refreshCatalog: options.refreshCatalog,
      listingIngestState: options.listingIngestState,
      ingestFailuresPath: options.ingestFailuresPath,
      onProgress,
      onIngested: options.onIngested,
    });
    return mapResult(source.id, options.catalogUrl, result);
  }

  const result = await runBizBuySellCatalogScrapeWithBrowser({
    catalogUrl: options.catalogUrl,
    evidence: options.evidence,
    processedArtifacts: options.processedArtifacts,
    metadata: options.metadata,
    listingIngestState: options.listingIngestState,
    ingestFailuresPath: options.ingestFailuresPath,
    prioritizeIngestFailures: options.prioritizeIngestFailures,
    useFixtures: options.useFixtures,
    skipBrowser: options.skipBrowser,
    headed: options.headed,
    maxPages: options.maxPages,
    maxListings: options.maxListings,
    ingestLimit: discoverOnly ? 0 : options.ingestLimit,
    discoverOnly,
    listingRefs: options.listingRefs,
    resumeCatalogDiscovery: options.resumeCatalogDiscovery,
    catalogRefsCheckpointPath: options.catalogRefsCheckpointPath,
    refreshCatalog: options.refreshCatalog,
    dedupEmbed: options.dedupEmbed,
    onProgress,
    onIngested: options.onIngested,
  });
  return mapResult(source.id, options.catalogUrl, result);
}

function mapResult(
  adapter: CatalogSourceId,
  catalogUrl: string,
  result: {
    pagesFetched: number;
    listingsDiscovered: number;
    listingsIngested?: number;
    listingsFailed?: number;
    listingsSkippedKnown?: number;
    listingsSkippedFresh?: number;
    canonicalIds?: string[];
    discoveredListingRefs?: ListingRef[];
    discoveredListingUrls?: string[];
    searchEvidenceKey: string;
  },
): CatalogScrapeRunResult {
  return {
    adapter,
    catalogUrl,
    pagesFetched: result.pagesFetched,
    listingsDiscovered: result.listingsDiscovered,
    listingsIngested: result.listingsIngested ?? 0,
    listingsFailed: result.listingsFailed ?? 0,
    listingsSkippedKnown: result.listingsSkippedKnown ?? 0,
    listingsSkippedFresh: result.listingsSkippedFresh ?? 0,
    canonicalIds: result.canonicalIds ?? [],
    discoveredListingRefs: result.discoveredListingRefs,
    discoveredListingUrls: result.discoveredListingUrls,
    searchEvidenceKey: result.searchEvidenceKey,
  };
}
