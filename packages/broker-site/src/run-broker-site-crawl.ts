import type { SourceRecord } from "@clearbolt/core";
import type { IngestSourceResult } from "@clearbolt/dedup";
import { BrokerSiteDedupKeyer, ingestSourceRecord } from "@clearbolt/dedup";
import type { EvidenceStore, MetadataStore, ProcessedArtifactStore } from "@clearbolt/storage";
import {
  HttpFetcher,
  buildSourceRecord,
  fetchHtmlWithHttpWafPolicy,
  htmlListingBodyFingerprint,
  htmlListingBodyText,
  persistListingProcessedArtifacts,
  throttleHost,
  type Fetcher,
  type ListingIngestStateStore,
} from "@clearbolt/scraper";
import { isBrokerSiteCrawlAllowed, brokerSiteAllowlistFromEnv } from "./allowlist.js";
import {
  readBrokerSiteCrawlState,
  writeBrokerSiteCrawlState,
  type BrokerSiteCrawlStateFile,
} from "./broker-site-crawl-state.js";
import { defaultBrokerSiteCrawlStatePath } from "./broker-site-crawl-path.js";
import { discoverListingIndexUrls } from "./discover-listings-index.js";
import {
  discoverListingLinksFromPage,
  externalIdFromBrokerSiteUrl,
  type BrokerSiteListingLink,
} from "./discover-listing-links.js";
import { isMarketplaceHost, isMarketplaceUrl } from "./marketplace-hosts.js";
import {
  parseBrokerSiteListingPage,
  toParsedListingFields,
} from "./parse-broker-site-listing.js";
import {
  brokerSiteLlmExtractEnabled,
  extractListingsFromIndexViaLlm,
} from "./broker-site-llm-extract.js";
import {
  walkBrokerSiteIndexPages,
  type BrokerSiteIndexPaginationState,
} from "./walk-broker-site-index.js";

export const BROKER_SITE_ADAPTER_ID = "broker-site";

export type RunBrokerSiteCrawlOptions = {
  siteUrl: string;
  evidence: EvidenceStore;
  processedArtifacts: ProcessedArtifactStore;
  metadata: MetadataStore;
  listingIngestState?: ListingIngestStateStore;
  fetcher?: Fetcher;
  ingestLimit?: number;
  discoverOnly?: boolean;
  /** Max distinct listing-index URLs to scan (home + discovered paths). */
  maxIndexUrls?: number;
  /** Max paginated pages per listing index (0 = unlimited until no next). */
  maxPagesPerIndex?: number;
  maxListingLinks?: number;
  /** Checkpoint path; defaults to data/broker-site-crawls/<slug>.json */
  crawlStatePath?: string;
  /** Load existing crawl state and continue incomplete index pagination. */
  resume?: boolean;
  dataRootDir?: string;
  onProgress?: (ev: { phase: string; message: string }) => void;
  onIngested?: (payload: {
    record: SourceRecord;
    result: IngestSourceResult;
  }) => void;
};

export type RunBrokerSiteCrawlResult = {
  siteUrl: string;
  indexPagesFetched: number;
  listingLinksDiscovered: number;
  listingsIngested: number;
  listingUrls: string[];
  canonicalIds: string[];
  crawlStatePath?: string;
  indexPagination: BrokerSiteIndexPaginationState[];
};

function paginationForIndex(
  states: BrokerSiteIndexPaginationState[],
  indexUrl: string,
): BrokerSiteIndexPaginationState | undefined {
  return states.find((s) => s.indexUrl === indexUrl);
}

function mergeLinkMap(
  linkMap: Map<string, BrokerSiteListingLink>,
  links: BrokerSiteListingLink[],
  maxLinks: number,
): void {
  for (const link of links) {
    if (linkMap.size >= maxLinks) return;
    if (isMarketplaceUrl(link.url)) continue;
    linkMap.set(link.url, link);
  }
}

export async function runBrokerSiteCrawl(
  options: RunBrokerSiteCrawlOptions,
): Promise<RunBrokerSiteCrawlResult> {
  const siteUrl = options.siteUrl.trim();
  const u = new URL(siteUrl);
  if (isMarketplaceHost(u.hostname)) {
    throw new Error(
      `Refusing marketplace host for broker-site crawl: ${u.hostname}. Use a broker-owned domain.`,
    );
  }

  const allowlist = brokerSiteAllowlistFromEnv();
  if (!isBrokerSiteCrawlAllowed(siteUrl, allowlist)) {
    throw new Error(
      `Host not on CLEARBOLT_BROKER_SITE_ALLOWLIST: ${u.hostname}`,
    );
  }

  const fetcher =
    options.fetcher ?? new HttpFetcher({ sessionKey: process.env.CLEARBOLT_PROXY_SESSION ?? "" });
  const wafPolicy = {
    persistNeedsBrowser: async () => {},
    hostRequiresBrowser: async () => false,
    maxHttpAttempts: 3,
    throttleMsBetweenRetries: 2000,
  };

  const canonicalIds: string[] = [];
  const keyer = new BrokerSiteDedupKeyer();
  const maxIndexUrls = options.maxIndexUrls ?? 8;
  const maxLinks = options.maxListingLinks ?? 200;
  const maxPagesPerIndex =
    options.maxPagesPerIndex ??
    (Number.parseInt(
      process.env.CLEARBOLT_BROKER_SITE_MAX_INDEX_PAGES ?? "0",
      10,
    ) || 0);

  const dataRoot = options.dataRootDir ?? process.env.DATA_DIR ?? "data";
  const crawlStatePath =
    options.crawlStatePath ?? defaultBrokerSiteCrawlStatePath(siteUrl, dataRoot);

  let priorState: BrokerSiteCrawlStateFile | undefined;
  if (options.resume !== false) {
    try {
      priorState = await readBrokerSiteCrawlState(crawlStatePath);
    } catch {
      priorState = undefined;
    }
  }

  const linkMap = new Map<string, BrokerSiteListingLink>();
  if (priorState?.listingUrls?.length) {
    for (const url of priorState.listingUrls) {
      linkMap.set(url, { url });
    }
  }

  const indexPagination: BrokerSiteIndexPaginationState[] = [
    ...(priorState?.indexPagination ?? []),
  ];

  async function checkpoint(partial?: {
    complete?: boolean;
    listingUrls?: string[];
  }): Promise<void> {
    const listingUrls = partial?.listingUrls ?? [...linkMap.keys()];
    const pagesFetchedTotal = indexPagination.reduce(
      (n, s) => n + s.pagesFetched,
      0,
    );
    await writeBrokerSiteCrawlState(crawlStatePath, {
      siteUrl,
      listingUrls,
      indexPagination,
      complete: partial?.complete,
      pagesFetchedTotal,
    });
  }

  options.onProgress?.({ phase: "discovery", message: `Fetching ${siteUrl}` });
  await throttleHost(u.hostname, 500);
  const home = await fetchHtmlWithHttpWafPolicy(fetcher, siteUrl, wafPolicy);
  if (isMarketplaceUrl(home.finalUrl)) {
    throw new Error(`Redirected to marketplace: ${home.finalUrl}`);
  }

  let indexUrls = discoverListingIndexUrls(home.body, home.finalUrl).slice(
    0,
    maxIndexUrls,
  );
  if (indexUrls.length === 0 && home.finalUrl) {
    indexUrls = [home.finalUrl];
  }

  const discoverLinks = (html: string, pageUrl: string): BrokerSiteListingLink[] => {
    if (brokerSiteLlmExtractEnabled()) {
      return [];
    }
    return discoverListingLinksFromPage(html, pageUrl, { maxLinks });
  };

  for (const indexUrl of indexUrls) {
    const initialPagination = paginationForIndex(indexPagination, indexUrl);

    const walkResult = await walkBrokerSiteIndexPages({
      indexUrl,
      maxPages: maxPagesPerIndex,
      initialPagination,
      discoverLinks,
      onProgress: (msg) =>
        options.onProgress?.({ phase: "discovery", message: msg }),
      onPageComplete: async (state) => {
        const idx = indexPagination.findIndex((s) => s.indexUrl === indexUrl);
        if (idx >= 0) indexPagination[idx] = state;
        else indexPagination.push(state);
        await checkpoint({ complete: false });
      },
      fetchPage: async (url, ctx) => {
        await throttleHost(new URL(url).hostname, 500);
        let body: string;
        let finalUrl: string;
        if (url === home.finalUrl && ctx.pageIndex === 0 && !initialPagination) {
          body = home.body;
          finalUrl = home.finalUrl;
        } else {
          const res = await fetchHtmlWithHttpWafPolicy(fetcher, url, wafPolicy);
          body = res.body;
          finalUrl = res.finalUrl;
        }
        if (isMarketplaceUrl(finalUrl)) {
          throw new Error(`Redirected to marketplace: ${finalUrl}`);
        }

        if (brokerSiteLlmExtractEnabled()) {
          const plain = htmlListingBodyText(body);
          const llmLinks = await extractListingsFromIndexViaLlm(plain, finalUrl, {
            siteUrl,
          });
          mergeLinkMap(linkMap, llmLinks, maxLinks);
        } else {
          mergeLinkMap(linkMap, discoverLinks(body, finalUrl), maxLinks);
        }

        return { body, finalUrl };
      },
    });

    mergeLinkMap(linkMap, walkResult.links, maxLinks);
    const idx = indexPagination.findIndex((s) => s.indexUrl === indexUrl);
    if (idx >= 0) indexPagination[idx] = walkResult.pagination;
    else indexPagination.push(walkResult.pagination);
  }

  const listingUrls = [...linkMap.keys()];
  const indexPagesFetched = indexPagination.reduce(
    (n, s) => n + s.pagesFetched,
    0,
  );

  options.onProgress?.({
    phase: "discovery",
    message: `Found ${listingUrls.length} listing URL(s) across ${indexUrls.length} index(es), ${indexPagesFetched} page(s) fetched`,
  });

  const discoveryComplete = indexPagination.every((s) => s.complete);
  await checkpoint({
    listingUrls,
    complete: discoveryComplete && (options.discoverOnly || (options.ingestLimit ?? 0) === 0),
  });

  if (options.discoverOnly || (options.ingestLimit ?? 0) === 0) {
    return {
      siteUrl,
      indexPagesFetched,
      listingLinksDiscovered: listingUrls.length,
      listingsIngested: 0,
      listingUrls,
      canonicalIds: [],
      crawlStatePath,
      indexPagination,
    };
  }

  const limit = options.ingestLimit ?? listingUrls.length;
  const toIngest = listingUrls.slice(0, limit);
  let listingsIngested = 0;

  for (const listingUrl of toIngest) {
    options.onProgress?.({ phase: "ingest", message: `Listing ${listingUrl}` });
    await throttleHost(new URL(listingUrl).hostname, 800);
    const res = await fetchHtmlWithHttpWafPolicy(fetcher, listingUrl, wafPolicy);
    const parsed = parseBrokerSiteListingPage(res.body, res.finalUrl);
    const externalId = externalIdFromBrokerSiteUrl(res.finalUrl);

    const buf = Buffer.from(res.body, "utf8");
    const evidenceRef = await options.evidence.put(buf, {
      adapter: BROKER_SITE_ADAPTER_ID,
      contentType: "text/html",
      sourceUrl: res.finalUrl,
    });

    const fingerprint = htmlListingBodyFingerprint(res.body);
    const record = buildSourceRecord({
      url: res.finalUrl,
      adapter: BROKER_SITE_ADAPTER_ID,
      externalId,
      parsed: toParsedListingFields(parsed, res.finalUrl),
      evidenceRef,
      bodyFingerprint: fingerprint,
    });

    const processed = await persistListingProcessedArtifacts(
      options.processedArtifacts,
      {
        adapter: BROKER_SITE_ADAPTER_ID,
        sourceUrl: res.finalUrl,
        rawEvidenceSha256: evidenceRef.sha256,
        html: res.body,
        parsed: toParsedListingFields(parsed, res.finalUrl),
      },
    );
    record.processedArtifacts = processed;

    const ingestResult = await ingestSourceRecord(options.metadata, record, {
      keyer,
    });
    canonicalIds.push(ingestResult.canonicalId);
    listingsIngested++;
    options.onIngested?.({ record, result: ingestResult });
  }

  await checkpoint({ listingUrls, complete: true });

  return {
    siteUrl,
    indexPagesFetched,
    listingLinksDiscovered: listingUrls.length,
    listingsIngested,
    listingUrls,
    canonicalIds,
    crawlStatePath,
    indexPagination,
  };
}
