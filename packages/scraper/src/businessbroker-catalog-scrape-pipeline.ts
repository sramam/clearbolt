import type { ListingRef, SourceRecord } from "@clearbolt/core";
import {
  BusinessBrokerDedupKeyer,
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
  BUSINESSBROKER_ADAPTER_ID,
  buildSourceRecord,
  parseListingPage,
} from "./adapters/businessbroker.js";
import {
  businessBrokerCatalogAdapter,
  discoverNextBusinessBrokerCatalogPageUrl,
  isBusinessBrokerCatalogUrl,
  normalizeBusinessBrokerCatalogUrlForCompare,
  recoverBusinessBrokerCatalogPageUrl,
} from "./adapters/businessbroker/catalog.js";
import type { ResumeCatalogDiscovery } from "./bizbuysell-catalog-scrape-pipeline.js";
import { catalogPageGapMs } from "./bizbuysell-run-policy.js";
import { writeCatalogRefsFile } from "./catalog-refs-file.js";
import { walkCatalogPages } from "./discovery/catalog-walk.js";
import { mergeListingRefByExternalId } from "./discovery/listing-ref-merge.js";
import { fetchHtmlWithHttpWafPolicy } from "./fetch-with-waf-policy.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import type { Fetcher } from "./fetcher.js";
import { htmlListingBodyFingerprint } from "./html-body-fingerprint.js";
import { HttpFetcher } from "./http-fetcher.js";
import {
  clearIngestFailure,
  recordIngestFailure,
} from "./ingest-failure-collection.js";
import { persistListingProcessedArtifacts } from "./listing-artifacts.js";
import {
  catalogStalePagesToStop,
  externalIdFromListingRef,
  persistListingIngestState,
} from "./listing-ingest-state.js";
import type { ListingIngestStateStore } from "./listing-ingest-state.js";
import { proxySessionKeyFromEnv } from "./proxy-config.js";
import { throttleHost } from "./throttle.js";

export type { ResumeCatalogDiscovery };

export interface RunBusinessBrokerCatalogScrapeOptions {
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
  listingIngestState?: ListingIngestStateStore;
  ingestFailuresPath?: string;
}

export interface RunBusinessBrokerCatalogScrapeResult {
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

async function collectRefsFromCatalog(
  fetcher: Fetcher,
  startUrl: string,
  options: RunBusinessBrokerCatalogScrapeOptions,
): Promise<{
  refs: ListingRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}> {
  const adapter = businessBrokerCatalogAdapter;
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
    isCatalogUrl: isBusinessBrokerCatalogUrl,
    recoverCatalogPageUrl: recoverBusinessBrokerCatalogPageUrl,
    normalizeCatalogUrlForCompare: normalizeBusinessBrokerCatalogUrlForCompare,
    onProgress: options.onProgress,
    fetchPage: async (url, ctx) => {
      if (ctx.pageIndex > 0 && pageGapMs > 0) {
        await throttleHost(new URL(url).hostname, pageGapMs);
      }
      const res = await fetcher.fetch({ url });
      return { body: res.body, finalUrl: res.finalUrl || url };
    },
    discoverRefs: (html, pageUrl) =>
      adapter.discoverListingRefsFromPage(html, pageUrl),
    discoverNext: (html, pageUrl) =>
      discoverNextBusinessBrokerCatalogPageUrl(html, pageUrl),
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
              adapter: BUSINESSBROKER_ADAPTER_ID,
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
  options: RunBusinessBrokerCatalogScrapeOptions,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  ref: ListingRef,
  keyer: BusinessBrokerDedupKeyer,
): Promise<boolean> {
  const freshness = await shouldSkipListingFetch(options.metadata, keyer, {
    adapter: BUSINESSBROKER_ADAPTER_ID,
    url: ref.url,
    externalId: ref.externalId,
  });
  if (freshness.skip) return false;

  const res = await fetchHtmlWithHttpWafPolicy(fetcher, ref.url, wafPolicy);
  const html = res.body;
  const finalUrl = res.finalUrl || ref.url;
  const evRef = await options.evidence.put(Buffer.from(html, "utf8"), {
    adapter: BUSINESSBROKER_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: finalUrl,
  });
  const parsed = parseListingPage(html, finalUrl);
  const listingId = ref.externalId ?? parsed.externalId ?? parsed.listingId;
  const bodyFingerprint = htmlListingBodyFingerprint(html);
  options.onProgress?.({
    phase: "process",
    message: `Parsed listing ${listingId ?? finalUrl}${parsed.brokerName ? ` (broker: ${parsed.brokerName})` : ""}`,
  });
  const artifacts = await persistListingProcessedArtifacts(
    options.processedArtifacts,
    {
      adapter: BUSINESSBROKER_ADAPTER_ID,
      sourceUrl: finalUrl,
      rawEvidenceSha256: evRef.sha256,
      html,
      parsed: { ...parsed, externalId: listingId, listingId },
    },
  );
  const record = buildSourceRecord({
    url: finalUrl,
    adapter: BUSINESSBROKER_ADAPTER_ID,
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
  if (listingId && options.ingestFailuresPath) {
    await clearIngestFailure(options.ingestFailuresPath, listingId).catch(
      () => undefined,
    );
  }
  if (listingId && options.listingIngestState) {
    await persistListingIngestState(options.listingIngestState, {
      adapter: BUSINESSBROKER_ADAPTER_ID,
      externalId: listingId,
      url: finalUrl,
      status: "ingested",
    }).catch(() => undefined);
  }
  return true;
}

async function ingestOneListingWithFailureLog(
  options: RunBusinessBrokerCatalogScrapeOptions,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  ref: ListingRef,
  keyer: BusinessBrokerDedupKeyer,
): Promise<boolean> {
  try {
    return await ingestOneListing(options, fetcher, wafPolicy, ref, keyer);
  } catch (err) {
    const failId = externalIdFromListingRef(ref);
    if (options.ingestFailuresPath) {
      await recordIngestFailure(
        options.ingestFailuresPath,
        ref,
        BUSINESSBROKER_ADAPTER_ID,
        err,
      ).catch(() => undefined);
    }
    if (failId && options.listingIngestState) {
      await persistListingIngestState(options.listingIngestState, {
        adapter: BUSINESSBROKER_ADAPTER_ID,
        externalId: failId,
        url: ref.url,
        status: "failed",
      }).catch(() => undefined);
    }
    return false;
  }
}

export async function runBusinessBrokerCatalogScrape(
  options: RunBusinessBrokerCatalogScrapeOptions,
): Promise<RunBusinessBrokerCatalogScrapeResult> {
  const catalogUrl = options.catalogUrl.trim();
  if (!isBusinessBrokerCatalogUrl(catalogUrl)) {
    throw new Error(
      `Not a BusinessBroker.net catalog URL (expected /state|industry|keyword|city|county/*-businesses-for-sale.aspx): ${catalogUrl}`,
    );
  }

  const fetcher = new HttpFetcher({ sessionKey: proxySessionKeyFromEnv() });
  const wafPolicy: FetchHtmlWithHttpWafPolicyOptions = {
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
    proxySessionKey: proxySessionKeyFromEnv(),
    maxHttpAttempts: 4,
    throttleMsBetweenRetries: 2000,
    /** BBN robots.txt ends with `Disallow: /` for `*`; catalog walk already uses direct HTTP. */
    crawlGate: { skipRobots: true },
  };

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

  const searchBuf = Buffer.from(lastHtml, "utf8");
  const searchRef = await options.evidence.put(searchBuf, {
    adapter: BUSINESSBROKER_ADAPTER_ID,
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
  const keyer = new BusinessBrokerDedupKeyer();
  const canonicalIds: string[] = [];
  let listingsIngested = 0;

  options.onProgress?.({
    phase: "fetch",
    message: `Ingesting up to ${toIngest.length} of ${refs.length} discovered listing URL(s)…`,
    total: toIngest.length,
  });

  for (let i = 0; i < toIngest.length; i++) {
    const ref = toIngest[i];
    if (ref === undefined) continue;
    const ingested = await ingestOneListingWithFailureLog(
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
