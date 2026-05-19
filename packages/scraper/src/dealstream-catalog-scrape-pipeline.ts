import type { ListingRef, SourceRecord } from "@clearbolt/core";
import {
  DealStreamDedupKeyer,
  ingestSourceRecord,
  shouldSkipListingFetch,
} from "@clearbolt/dedup";
import type { IngestSourceResult } from "@clearbolt/dedup";
import type {
  EvidenceStore,
  MetadataStore,
  ProcessedArtifactStore,
} from "@clearbolt/storage";
import {
  DEALSTREAM_ADAPTER_ID,
  buildSourceRecord,
  fetchListingHtmlWithWafPolicy,
  parseAndEnrichListingPage,
  toParsedListingFields,
} from "./adapters/dealstream.js";
import {
  discoverNextDealStreamCatalogPageUrl,
  isDealStreamCatalogUrl,
  normalizeDealStreamCatalogUrlForCompare,
  recoverDealStreamCatalogPageUrl,
} from "./adapters/dealstream/catalog.js";
import { writeCatalogRefsFile } from "./catalog-refs-file.js";
import { walkCatalogPages } from "./discovery/catalog-walk.js";
import { mergeListingRefByExternalId } from "./discovery/listing-ref-merge.js";
import type { Fetcher } from "./fetcher.js";
import { HttpFetcher } from "./http-fetcher.js";
import { catalogPageGapMs } from "./bizbuysell-run-policy.js";
import { catalogStalePagesToStop } from "./listing-ingest-state.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import { htmlListingBodyFingerprint } from "./html-body-fingerprint.js";
import { persistListingProcessedArtifacts } from "./listing-artifacts.js";
import { proxySessionKeyFromEnv } from "./proxy-config.js";
import { throttleHost } from "./throttle.js";
import type { ResumeCatalogDiscovery } from "./bizbuysell-catalog-scrape-pipeline.js";
import { discoverListingRefsFromDealStreamCatalogPage } from "./adapters/dealstream/catalog.js";

export type { ResumeCatalogDiscovery };

export interface RunDealStreamCatalogScrapeOptions {
  catalogUrl: string;
  evidence: EvidenceStore;
  metadata: MetadataStore;
  processedArtifacts: ProcessedArtifactStore;
  maxPages?: number;
  maxListings?: number;
  ingestLimit?: number;
  discoverOnly?: boolean;
  listingRefs?: ListingRef[];
  refreshCatalog?: boolean;
  resumeCatalogDiscovery?: ResumeCatalogDiscovery;
  catalogRefsCheckpointPath?: string;
  /** Playwright fetcher (required for live DealStream; DataDome blocks plain HTTP). */
  browserFetcher?: Fetcher;
  onProgress?: (ev: {
    phase: "discovery" | "fetch" | "process" | "ingest";
    message: string;
    current?: number;
    total?: number;
  }) => void;
  onIngested?: (args: {
    record: SourceRecord;
    result: IngestSourceResult;
  }) => void;
}

export interface RunDealStreamCatalogScrapeResult {
  pagesFetched: number;
  listingsDiscovered: number;
  listingsIngested: number;
  catalogUrl: string;
  discoveredListingUrls?: string[];
  discoveredListingRefs?: ListingRef[];
  searchEvidenceKey: string;
  canonicalIds: string[];
}

function defaultMaxPages(): number {
  const raw = process.env.CLEARBOLT_CATALOG_MAX_PAGES;
  if (raw === undefined || raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

function listingIngestWafPolicy(
  options: RunDealStreamCatalogScrapeOptions,
): FetchHtmlWithHttpWafPolicyOptions {
  return {
    persistNeedsBrowser: async (host) => {
      await options.metadata.putDomainProfile({
        host,
        needsBrowser: true,
        lastUpdatedAt: new Date().toISOString(),
      });
    },
    hostRequiresBrowser: async (host) => {
      const p = await options.metadata.getDomainProfile(host);
      return p?.needsBrowser === true;
    },
    browserFetcher: options.browserFetcher,
    proxySessionKey: proxySessionKeyFromEnv(),
    maxHttpAttempts: 4,
    throttleMsBetweenRetries: 2000,
  };
}

async function collectRefsFromCatalog(
  fetcher: Fetcher,
  startUrl: string,
  options: RunDealStreamCatalogScrapeOptions,
): Promise<{
  refs: ListingRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}> {
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
    isCatalogUrl: isDealStreamCatalogUrl,
    recoverCatalogPageUrl: recoverDealStreamCatalogPageUrl,
    normalizeCatalogUrlForCompare: normalizeDealStreamCatalogUrlForCompare,
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
      discoverListingRefsFromDealStreamCatalogPage(html, pageUrl),
    discoverNext: (html, pageUrl) =>
      discoverNextDealStreamCatalogPageUrl(html, pageUrl),
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
              adapter: DEALSTREAM_ADAPTER_ID,
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

async function ingestOneListing(
  options: RunDealStreamCatalogScrapeOptions,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  ref: ListingRef,
  keyer: DealStreamDedupKeyer,
): Promise<boolean> {
  const freshness = await shouldSkipListingFetch(options.metadata, keyer, {
    adapter: DEALSTREAM_ADAPTER_ID,
    url: ref.url,
    externalId: ref.externalId,
  });
  if (freshness.skip) return false;

  const { html, finalUrl } = await fetchListingHtmlWithWafPolicy(
    fetcher,
    ref,
    wafPolicy,
  );
  const evRef = await options.evidence.put(Buffer.from(html, "utf8"), {
    adapter: DEALSTREAM_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: finalUrl,
  });
  const extract = await parseAndEnrichListingPage(html, finalUrl, {
    fetcher,
    wafPolicy,
  });
  const listingId = ref.externalId ?? extract.externalId ?? extract.listingId;
  const parsed = toParsedListingFields({
    ...extract,
    externalId: listingId,
    listingId,
  });
  const bodyFingerprint = htmlListingBodyFingerprint(html);
  options.onProgress?.({
    phase: "process",
    message: `Parsed listing ${listingId ?? finalUrl}${parsed.brokerName ? ` (broker: ${parsed.brokerName})` : ""}`,
  });
  const artifacts = await persistListingProcessedArtifacts(
    options.processedArtifacts,
    {
      adapter: DEALSTREAM_ADAPTER_ID,
      sourceUrl: finalUrl,
      rawEvidenceSha256: evRef.sha256,
      html,
      parsed: { ...parsed, externalId: listingId, listingId },
    },
  );
  const record = buildSourceRecord({
    url: finalUrl,
    adapter: DEALSTREAM_ADAPTER_ID,
    parsed,
    externalId: listingId,
    evidenceRef: evRef,
    processedArtifacts: artifacts,
    bodyFingerprint,
  });
  const ingestResult = await ingestSourceRecord(options.metadata, record, {
    keyer,
  });
  options.onIngested?.({ record, result: ingestResult });
  return true;
}

export async function runDealStreamCatalogScrape(
  options: RunDealStreamCatalogScrapeOptions,
): Promise<RunDealStreamCatalogScrapeResult> {
  const catalogUrl = options.catalogUrl.trim();
  if (!isDealStreamCatalogUrl(catalogUrl)) {
    throw new Error(
      `Not a DealStream catalog URL (expected *-businesses-for-sale or /biz-sale): ${catalogUrl}`,
    );
  }

  const fetcher =
    options.browserFetcher ??
    new HttpFetcher({ sessionKey: proxySessionKeyFromEnv() });
  const wafPolicy = listingIngestWafPolicy(options);

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

  const searchRef = await options.evidence.put(Buffer.from(lastHtml, "utf8"), {
    adapter: DEALSTREAM_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: lastPageUrl,
  });

  options.onProgress?.({
    phase: "discovery",
    message: `Discovery complete: ${refs.length} unique listing URL(s) from ${pagesFetched} catalog page(s)`,
  });

  if (options.discoverOnly) {
    return {
      pagesFetched,
      listingsDiscovered: refs.length,
      listingsIngested: 0,
      catalogUrl,
      discoveredListingUrls: refs.map((r) => r.url),
      discoveredListingRefs: refs,
      searchEvidenceKey: searchRef.key,
      canonicalIds: [],
    };
  }

  const ingestLimit = options.ingestLimit ?? 0;
  const toIngest = ingestLimit > 0 ? refs.slice(0, ingestLimit) : refs;
  const keyer = new DealStreamDedupKeyer();
  const canonicalIds: string[] = [];
  let listingsIngested = 0;

  options.onProgress?.({
    phase: "fetch",
    message: `Ingesting up to ${toIngest.length} of ${refs.length} discovered listing URL(s)…`,
    total: toIngest.length,
  });

  for (let i = 0; i < toIngest.length; i++) {
    const ref = toIngest[i]!;
    const ingested = await ingestOneListing(
      {
        ...options,
        onIngested: (args) => {
          if (!canonicalIds.includes(args.result.canonicalId)) {
            canonicalIds.push(args.result.canonicalId);
          }
          options.onIngested?.(args);
        },
      },
      fetcher,
      wafPolicy,
      ref,
      keyer,
    );
    if (ingested) listingsIngested++;
    options.onProgress?.({
      phase: "ingest",
      message: `${i + 1} / ${toIngest.length} processed`,
      current: i + 1,
      total: toIngest.length,
    });
  }

  return {
    pagesFetched,
    listingsDiscovered: refs.length,
    listingsIngested,
    catalogUrl,
    discoveredListingUrls: refs.map((r) => r.url),
    discoveredListingRefs: refs,
    searchEvidenceKey: searchRef.key,
    canonicalIds,
  };
}
