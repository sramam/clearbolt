import type { ListingRef, SourceRecord } from "@clearbolt/core";
import {
  BizQuestDedupKeyer,
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
  assertAdapterScopedPutMeta,
  assertEvidenceRefMatchesAdapter,
} from "./adapter-scoped-paths.js";
import {
  BIZQUEST_ADAPTER_ID,
  buildSourceRecord,
  discoverListingRefs,
  discoverNextSearchPageUrl,
  parseListingPage,
  parseSearchUrl,
} from "./adapters/bizquest.js";
import { fetchHtmlWithHttpWafPolicy } from "./fetch-with-waf-policy.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import type { Fetcher } from "./fetcher.js";
import { buildBizQuestFixtureFetcher } from "./fixtures/build-bizquest-fixture-fetcher.js";
import { htmlListingBodyFingerprint } from "./html-body-fingerprint.js";
import { HttpFetcher } from "./http-fetcher.js";
import {
  clearIngestFailure,
  recordIngestFailure,
} from "./ingest-failure-collection.js";
import { persistListingProcessedArtifacts } from "./listing-artifacts.js";
import type { ListingIngestStateStore } from "./listing-ingest-state.js";
import { proxySessionKeyFromEnv } from "./proxy-config.js";

export interface RunBizQuestScrapeOptions {
  evidence: EvidenceStore;
  metadata: MetadataStore;
  processedArtifacts: ProcessedArtifactStore;
  searchUrl: string;
  limit?: number;
  useFixtures?: boolean;
  browserFetcher?: Fetcher;
  listingIngestState?: ListingIngestStateStore;
  ingestFailuresPath?: string;
  onIngested?: (args: {
    record: SourceRecord;
    result: IngestSourceResult;
  }) => void;
  onProgress?: (event: {
    phase: "discovery" | "fetch" | "process" | "ingest";
    message: string;
    current?: number;
    total?: number;
  }) => void;
}

export interface RunBizQuestScrapeResult {
  listingsIngested: number;
  searchEvidenceKey: string;
  effectiveSearchUrl: string;
  canonicalIds: string[];
}

async function ingestOneListing(
  options: RunBizQuestScrapeOptions,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  ref: ListingRef,
  keyer: BizQuestDedupKeyer,
): Promise<boolean> {
  const freshness = await shouldSkipListingFetch(options.metadata, keyer, {
    adapter: BIZQUEST_ADAPTER_ID,
    url: ref.url,
    externalId: ref.externalId,
  });
  if (freshness.skip) return false;

  const res = await fetchHtmlWithHttpWafPolicy(fetcher, ref.url, wafPolicy);
  const html = res.body;
  const finalUrl = res.finalUrl || ref.url;
  const putMeta = {
    adapter: BIZQUEST_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: finalUrl,
  };
  assertAdapterScopedPutMeta(putMeta);
  const evRef = await options.evidence.put(Buffer.from(html, "utf8"), putMeta);
  assertEvidenceRefMatchesAdapter(evRef, BIZQUEST_ADAPTER_ID);
  const parsed = parseListingPage(html, finalUrl);
  const listingId = ref.externalId ?? parsed.externalId ?? parsed.listingId;
  const bodyFingerprint = htmlListingBodyFingerprint(html);
  options.onProgress?.({
    phase: "process",
    message: `Storing processed artifacts for ${listingId ?? finalUrl}`,
  });
  const processedArtifacts = await persistListingProcessedArtifacts(
    options.processedArtifacts,
    {
      adapter: BIZQUEST_ADAPTER_ID,
      sourceUrl: finalUrl,
      rawEvidenceSha256: evRef.sha256,
      html,
      parsed: { ...parsed, externalId: listingId, listingId },
    },
  );
  const record = buildSourceRecord({
    url: finalUrl,
    adapter: BIZQUEST_ADAPTER_ID,
    parsed,
    externalId: listingId,
    evidenceRef: evRef,
    processedArtifacts,
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
  return true;
}

async function ingestOneListingWithFailureLog(
  options: RunBizQuestScrapeOptions,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  ref: ListingRef,
  keyer: BizQuestDedupKeyer,
): Promise<boolean> {
  try {
    return await ingestOneListing(options, fetcher, wafPolicy, ref, keyer);
  } catch (err) {
    if (options.ingestFailuresPath) {
      await recordIngestFailure(
        options.ingestFailuresPath,
        ref,
        BIZQUEST_ADAPTER_ID,
        err,
      ).catch(() => undefined);
    }
    return false;
  }
}

export async function runBizQuestScrape(
  options: RunBizQuestScrapeOptions,
): Promise<RunBizQuestScrapeResult> {
  const searchUrlArg = options.searchUrl.trim();
  parseSearchUrl(searchUrlArg);
  const limit = options.limit ?? 10;
  const keyer = new BizQuestDedupKeyer();
  const canonicalIds: string[] = [];

  let fetcher: Fetcher;
  let effectiveSearch = searchUrlArg;
  if (options.useFixtures) {
    const bundle = await buildBizQuestFixtureFetcher();
    fetcher = bundle.fetcher;
    effectiveSearch = bundle.fixtureSearchUrl;
  } else if (options.browserFetcher) {
    fetcher = options.browserFetcher;
  } else {
    fetcher = new HttpFetcher({ sessionKey: proxySessionKeyFromEnv() });
  }

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
    browserFetcher: options.browserFetcher,
    proxySessionKey: proxySessionKeyFromEnv(),
    maxHttpAttempts: 4,
    throttleMsBetweenRetries: 2000,
  };

  options.onProgress?.({
    phase: "discovery",
    message: "Loading BizQuest search page…",
  });
  const searchRes = await fetchHtmlWithHttpWafPolicy(
    fetcher,
    effectiveSearch,
    wafPolicy,
  );
  const searchBuf = Buffer.from(searchRes.body, "utf8");
  const searchPutMeta = {
    adapter: BIZQUEST_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: searchRes.finalUrl || effectiveSearch,
  };
  assertAdapterScopedPutMeta(searchPutMeta);
  const searchRef = await options.evidence.put(searchBuf, searchPutMeta);
  assertEvidenceRefMatchesAdapter(searchRef, BIZQUEST_ADAPTER_ID);

  const refs: ListingRef[] = [];
  for await (const ref of discoverListingRefs(
    searchRes.body,
    searchRes.finalUrl || effectiveSearch,
  )) {
    refs.push(ref);
    if (refs.length >= limit) break;
  }

  options.onProgress?.({
    phase: "fetch",
    message: `Fetching ${refs.length} listing(s)…`,
    total: refs.length,
    current: 0,
  });

  const trackIngested = (args: {
    record: SourceRecord;
    result: IngestSourceResult;
  }) => {
    if (!canonicalIds.includes(args.result.canonicalId)) {
      canonicalIds.push(args.result.canonicalId);
    }
    options.onIngested?.(args);
  };

  let listingsIngested = 0;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (ref === undefined) continue;
    const ingested = await ingestOneListingWithFailureLog(
      { ...options, onIngested: trackIngested },
      fetcher,
      wafPolicy,
      ref,
      keyer,
    );
    if (ingested) {
      listingsIngested++;
    }
    options.onProgress?.({
      phase: "ingest",
      message: `${i + 1} / ${refs.length} processed`,
      current: i + 1,
      total: refs.length,
    });
  }

  void discoverNextSearchPageUrl(
    searchRes.body,
    searchRes.finalUrl || effectiveSearch,
  );

  return {
    listingsIngested,
    searchEvidenceKey: searchRef.key,
    effectiveSearchUrl: searchRes.finalUrl || effectiveSearch,
    canonicalIds,
  };
}
