import type { ListingRef } from "@clearbolt/core";
import {
  bizBuySellCatalogAdapter,
  isBizBuySellCatalogUrl,
} from "./adapters/bizbuysell-catalog.js";
import { rewriteBizBuySellToMobileUrl } from "./adapters/bizbuysell-mobile.js";
import { BIZBUYSELL_ADAPTER_ID } from "./adapters/bizbuysell.js";
import { discoverNextBizBuySellCatalogPageUrl } from "./adapters/bizbuysell/catalog.js";
import {
  catalogDiscoveryWafPolicy,
  catalogPageGapMs,
  listingIngestWafPolicy,
  primeBizBuySellResidentialHosts,
  shouldPreferHttpIngestForBizBuySell,
  shouldPreferMobileBizBuySellCatalog,
  shouldUseBrowserFirstForBizBuySell,
  shouldUseHttpProxyFirstForBizBuySell,
} from "./bizbuysell-run-policy.js";
import {
  type RunBizBuySellScrapeOptions,
  type RunBizBuySellScrapeResult,
  ingestListingRefs,
  withCanonicalTracking,
} from "./bizbuysell-scrape-pipeline.js";
import { writeCatalogRefsFile } from "./catalog-refs-file.js";
import { walkCatalogPages } from "./discovery/catalog-walk.js";
import { mergeListingRefByExternalId } from "./discovery/listing-ref-merge.js";
import { normalizeUrlForCompare } from "./discovery/pagination/normalize.js";
import { fetchHtmlWithHttpWafPolicy } from "./fetch-with-waf-policy.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import type { Fetcher } from "./fetcher.js";
import { HttpFetcher } from "./http-fetcher.js";
import {
  catalogStalePagesToStop,
  seedKnownKeysForCatalogDiscovery,
} from "./listing-ingest-state.js";
import { isTransientNetworkError } from "./network-errors.js";
import { readProxyPolicy, residentialProxyConfigured } from "./proxy-config.js";
import { proxySessionKeyFromEnv } from "./proxy-config.js";
import { createRotatingHttpFetcher } from "./rotating-proxy-fetcher.js";
import { throttleHost } from "./throttle.js";

export type ResumeCatalogDiscovery = {
  refs: ListingRef[];
  startUrl: string;
  pagesFetched?: number;
};

export interface RunBizBuySellCatalogScrapeOptions
  extends Omit<
    RunBizBuySellScrapeOptions,
    "searchUrl" | "searchKeywords" | "discovery"
  > {
  /** Catalog URL, e.g. california-businesses-for-sale. */
  catalogUrl: string;
  /** Try mobile host first (recommended for HTTP). Default true. */
  preferMobile?: boolean;
  /** Stop after this many listing pages (0 = until no next). Default from env or 200. */
  maxPages?: number;
  /** Cap total unique listings discovered (0 = no cap). */
  maxListings?: number;
  /** Ingest at most this many listings (0 = all discovered). */
  ingestLimit?: number;
  /** Stop after discovery; do not fetch listing detail pages. */
  discoverOnly?: boolean;
  /** Skip catalog walk; ingest these refs (from `--refs-file`). */
  listingRefs?: ListingRef[];
  /**
   * Full catalog rediscovery: do not seed stale-page stop from prior ingest state
   * (`clearbolt catalog --refresh`).
   */
  refreshCatalog?: boolean;
  /** Continue catalog walk from a checkpoint (`nextPageUrl` in catalog-refs file). */
  resumeCatalogDiscovery?: ResumeCatalogDiscovery;
  /** Write catalog-refs after each page (crash-safe discovery). */
  catalogRefsCheckpointPath?: string;
  /** HTTP+rotating Decodo per worker for ingest (default when multi-proxy file). */
  preferHttpIngest?: boolean;
  /** One Playwright session per HTTP worker for WAF fallback (not one shared browser). */
  perWorkerListingBrowserFallback?: boolean;
  listingBrowserFallbackHost?: string;
  /** `false` = headed Chromium (`--headed` / `CLEARBOLT_BROWSER_HEADLESS=0`). */
  listingBrowserHeadless?: boolean;
}

export interface RunBizBuySellCatalogScrapeResult
  extends RunBizBuySellScrapeResult {
  pagesFetched: number;
  listingsDiscovered: number;
  catalogUrl: string;
  /** Populated when `discoverOnly` is true (and after full discovery). */
  discoveredListingUrls?: string[];
  /** Full refs after discovery (for writing catalog-refs cache). */
  discoveredListingRefs?: ListingRef[];
}

function catalogFetchLaneLabel(): string {
  if (shouldUseBrowserFirstForBizBuySell()) return " (Playwright + proxy)";
  if (shouldUseHttpProxyFirstForBizBuySell()) return " (HTTP + proxy)";
  return "";
}

function isProxyTunnelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ERR_TUNNEL_CONNECTION_FAILED|ECONNREFUSED|proxy/i.test(msg);
}

/** Primary URL plus optional alt and the other BizBuySell host (www ↔ m.). */
export function catalogPageFetchTargets(
  url: string,
  altUrl?: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    const key = normalizeUrlForCompare(u);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(u);
    }
  };
  add(url);
  if (altUrl) add(altUrl);
  // www → m. often works on residential proxy; m. → www usually 403 (Akamai).
  if (url.includes("www.bizbuysell.com")) {
    add(rewriteBizBuySellToMobileUrl(url));
  }
  return out;
}

/**
 * Fetch one catalog page. On failure may fall back www → mobile only (never mobile → www).
 */
async function fetchCatalogPageHtml(
  fetcher: Fetcher,
  url: string,
  altUrl: string | undefined,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  options: RunBizBuySellCatalogScrapeOptions,
): Promise<{ body: string; finalUrl: string }> {
  const targets = catalogPageFetchTargets(url, altUrl);

  let lastErr: unknown;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (target === undefined) continue;
    try {
      const res = await fetchHtmlWithHttpWafPolicy(fetcher, target, wafPolicy);
      return { body: res.body, finalUrl: res.finalUrl || target };
    } catch (err) {
      lastErr = err;
      if (i < targets.length - 1) {
        const reason = isTransientNetworkError(err)
          ? "network timeout"
          : "fetch failed";
        options.onProgress?.({
          phase: "discovery",
          message: `Catalog ${reason} (${target}); retrying via ${targets[i + 1]}`,
        });
        continue;
      }
      if (isProxyTunnelError(err) || isTransientNetworkError(err)) {
        options.onProgress?.({
          phase: "discovery",
          message:
            "Proxy/network error — check Decodo session/balance and CLEARBOLT_PROXY_CONNECT_TIMEOUT_MS, then retry",
        });
      }
    }
  }
  const hint =
    "Check Decodo proxy in .env.cloud.local and export CLEARBOLT_BIZBUYSELL_BROWSER_FIRST=1 (use m.bizbuysell.com; www often blocks).";
  if (lastErr instanceof Error) {
    throw new Error(`${lastErr.message}\n\n${hint}`, { cause: lastErr });
  }
  throw new Error(`${String(lastErr)}\n\n${hint}`);
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
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  options: RunBizBuySellCatalogScrapeOptions,
): Promise<{
  refs: ListingRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}> {
  const adapter = bizBuySellCatalogAdapter;
  const httpProxyFirst = shouldUseHttpProxyFirstForBizBuySell();
  const browserFirst = shouldUseBrowserFirstForBizBuySell();
  const discoveryWaf = catalogDiscoveryWafPolicy(wafPolicy);
  const pageGapMs = catalogPageGapMs();
  const seedKnownListingKeys = options.refreshCatalog
    ? new Set<string>()
    : await seedKnownKeysForCatalogDiscovery(
        options.listingIngestState,
        BIZBUYSELL_ADAPTER_ID,
      );
  const stalePagesToStop = options.refreshCatalog
    ? 0
    : catalogStalePagesToStop();
  if (seedKnownListingKeys.size > 0) {
    options.onProgress?.({
      phase: "discovery",
      message: `Seeding ${seedKnownListingKeys.size} previously ingested listing id(s) for stale-page detection`,
    });
  }
  const resume = options.resumeCatalogDiscovery;
  if (resume) {
    options.onProgress?.({
      phase: "discovery",
      message: `Resuming catalog walk from page ${(resume.pagesFetched ?? 0) + 1} (${resume.refs.length} listing ref(s) loaded)`,
    });
  }

  const checkpointPath = options.catalogRefsCheckpointPath;
  const checkpointCatalogUrl = options.catalogUrl;

  return walkCatalogPages({
    startUrl,
    resumeFromUrl: resume?.startUrl,
    initialRefs: resume?.refs,
    initialPagesFetched: resume?.pagesFetched,
    catalogBaseUrl: options.catalogUrl,
    maxPages: options.maxPages ?? defaultMaxPages(),
    maxListings: options.maxListings ?? 0,
    mergeRef: mergeListingRefByExternalId,
    seedKnownListingKeys,
    stalePagesToStop,
    fetchLaneLabel: catalogFetchLaneLabel(),
    onProgress: options.onProgress,
    altUrlForFirstPage: (url) =>
      url.includes("m.bizbuysell.com")
        ? undefined
        : rewriteBizBuySellToMobileUrl(url),
    fetchPage: async (url, ctx) => {
      if (ctx.pageIndex > 0 && pageGapMs > 0) {
        await throttleHost(new URL(url).hostname, pageGapMs);
      }
      return fetchCatalogPageHtml(
        fetcher,
        url,
        ctx.altUrl,
        discoveryWaf,
        options,
      );
    },
    discoverRefs: (html, pageUrl) =>
      adapter.discoverListingRefsFromPage(html, pageUrl),
    discoverNext: (html, pageUrl, pageNumber) =>
      discoverNextBizBuySellCatalogPageUrl(html, pageUrl, {
        catalogBaseUrl: options.catalogUrl,
        currentPageNumber: pageNumber,
      }),
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
      if (process.env.CLEARBOLT_SCRAPER_DEBUG === "1") {
        console.error(
          `[scraper] catalog pagination: ${reason}${nextUrl ? ` → ${nextUrl}` : ""} (at ${lastPageUrl})`,
        );
      }
    },
    rewriteNextUrl: (next) => {
      const useMobile =
        (httpProxyFirst || browserFirst) && !next.includes("m.bizbuysell.com");
      return useMobile ? rewriteBizBuySellToMobileUrl(next) : next;
    },
    onPageComplete: checkpointPath
      ? async ({ refs, pagesFetched, lastPageUrl, nextPageUrl }) => {
          await writeCatalogRefsFile(checkpointPath, {
            adapter: BIZBUYSELL_ADAPTER_ID,
            catalogUrl: checkpointCatalogUrl,
            refs,
            complete: nextPageUrl === null,
            pagesFetched,
            lastPageUrl,
            nextPageUrl: nextPageUrl ?? undefined,
          });
        }
      : undefined,
  });
}

export async function runBizBuySellCatalogScrape(
  options: RunBizBuySellCatalogScrapeOptions,
): Promise<RunBizBuySellCatalogScrapeResult> {
  const catalogUrl = options.catalogUrl.trim();
  if (!isBizBuySellCatalogUrl(catalogUrl)) {
    throw new Error(
      `Not a BizBuySell catalog URL (expected *-businesses-for-sale): ${catalogUrl}`,
    );
  }

  primeBizBuySellResidentialHosts();
  if (readProxyPolicy() === "residential" && !residentialProxyConfigured()) {
    const file = process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE?.trim();
    throw new Error(
      file
        ? `Residential proxy file not found or empty: ${file} (create it from proxy-endpoints.example.txt)`
        : "CLEARBOLT_PROXY_POLICY=residential but no proxy configured. Set CLEARBOLT_PROXY_RESIDENTIAL or CLEARBOLT_PROXY_ENDPOINTS_FILE.",
    );
  }
  const browserFirst =
    Boolean(options.browserFetcher) && shouldUseBrowserFirstForBizBuySell();
  const preferMobile =
    options.preferMobile !== false && shouldPreferMobileBizBuySellCatalog();
  const fetchStart = preferMobile
    ? rewriteBizBuySellToMobileUrl(catalogUrl)
    : catalogUrl;

  let fetcher: Fetcher;
  if (options.useFixtures) {
    const { buildBizBuySellFixtureFetcher } = await import(
      "./fixtures/build-bizbuysell-fixture-fetcher.js"
    );
    const bundle = await buildBizBuySellFixtureFetcher();
    fetcher = bundle.fetcher;
  } else if (browserFirst && options.browserFetcher) {
    fetcher = options.browserFetcher;
  } else if (residentialProxyConfigured()) {
    fetcher = createRotatingHttpFetcher(0);
  } else {
    fetcher = new HttpFetcher({ sessionKey: proxySessionKeyFromEnv() });
  }

  const persistNeedsBrowser: FetchHtmlWithHttpWafPolicyOptions["persistNeedsBrowser"] =
    async (host) => {
      await options.metadata.putDomainProfile({
        host,
        needsBrowser: true,
        lastUpdatedAt: new Date().toISOString(),
      });
    };
  const hostRequiresBrowser: FetchHtmlWithHttpWafPolicyOptions["hostRequiresBrowser"] =
    async (host) => {
      const p = await options.metadata.getDomainProfile(host);
      return p?.needsBrowser === true;
    };

  const wafPolicy: FetchHtmlWithHttpWafPolicyOptions = {
    persistNeedsBrowser,
    hostRequiresBrowser,
    browserFetcher: options.browserFetcher,
    browserLanePrimary: browserFirst,
    proxySessionKey: proxySessionKeyFromEnv(),
    maxHttpAttempts: 4,
    throttleMsBetweenRetries: 3000,
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
    const walked = await collectRefsFromCatalog(
      fetcher,
      fetchStart,
      wafPolicy,
      options,
    );
    refs = walked.refs;
    pagesFetched = walked.pagesFetched;
    lastPageUrl = walked.lastPageUrl;
    lastHtml = walked.lastHtml;
  }

  const searchBuf = Buffer.from(lastHtml, "utf8");
  const searchRef = await options.evidence.put(searchBuf, {
    adapter: BIZBUYSELL_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: lastPageUrl,
  });

  if (options.discoverOnly) {
    options.onProgress?.({
      phase: "discovery",
      message: `Discovery complete: ${refs.length} unique listing URL(s) from ${pagesFetched} catalog page(s)`,
    });
    return {
      listingsIngested: 0,
      listingsDiscovered: refs.length,
      discoveredListingUrls: refs.map((r) => r.url),
      discoveredListingRefs: refs,
      pagesFetched,
      catalogUrl,
      serperSupplement: 0,
      searchEvidenceKey: searchRef.key,
      effectiveSearchUrl: lastPageUrl,
      discoveryMode: "direct",
      canonicalIds: [],
    };
  }

  const ingestLimit =
    options.ingestLimit ??
    (options.limit && options.limit > 0 ? options.limit : 0);
  const toIngest = ingestLimit > 0 ? refs.slice(0, ingestLimit) : refs;

  options.onProgress?.({
    phase: "fetch",
    message: `Ingesting up to ${toIngest.length} of ${refs.length} discovered listing URL(s)…`,
    total: toIngest.length,
  });

  const canonicalIds: string[] = [];
  const tracked = withCanonicalTracking(options, canonicalIds);
  const preferHttpIngest =
    options.preferHttpIngest ?? shouldPreferHttpIngestForBizBuySell();
  const ingestStats = await ingestListingRefs(
    tracked,
    fetcher,
    listingIngestWafPolicy(wafPolicy),
    toIngest,
    toIngest.length,
    {
      useRotatingHttpWorkers: options.useFixtures ? false : preferHttpIngest,
      perWorkerBrowserFallback: options.perWorkerListingBrowserFallback,
      browserFallbackProxyHost: options.listingBrowserFallbackHost,
      browserFallbackHeadless: options.listingBrowserHeadless,
      sharedBrowserFetcher:
        !preferHttpIngest && browserFirst && options.browserFetcher
          ? options.browserFetcher
          : undefined,
    },
  );

  return {
    listingsIngested: ingestStats.listingsIngested,
    listingsFailed: ingestStats.listingsFailed,
    listingsSkippedKnown: ingestStats.listingsSkippedKnown,
    listingsSkippedFresh: ingestStats.listingsSkippedFresh,
    listingsDiscovered: refs.length,
    discoveredListingUrls: refs.map((r) => r.url),
    discoveredListingRefs: refs,
    pagesFetched,
    catalogUrl,
    serperSupplement: 0,
    searchEvidenceKey: searchRef.key,
    effectiveSearchUrl: lastPageUrl,
    discoveryMode: "direct",
    canonicalIds,
  };
}
