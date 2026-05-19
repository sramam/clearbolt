import type { ListingRef } from "@clearbolt/core";
import { BIZBUYSELL_ADAPTER_ID } from "./adapters/bizbuysell.js";
import {
  assertBrokerProfileUrl,
  brokerProfileToRefs,
  parseBizBuySellBrokerProfilePage,
  type BrokerProfileExtract,
} from "./adapters/bizbuysell-broker-parse.js";
import { isBizBuySellBrokerProfileUrl } from "./bizbuysell-broker-url.js";
import type { Fetcher } from "./fetcher.js";
import { HttpFetcher } from "./http-fetcher.js";
import {
  ingestListingRefs,
  withCanonicalTracking,
  type RunBizBuySellScrapeOptions,
} from "./bizbuysell-scrape-pipeline.js";
import {
  listingIngestWafPolicy,
  primeBizBuySellResidentialHosts,
  shouldPreferHttpIngestForBizBuySell,
  shouldUseBrowserFirstForBizBuySell,
} from "./bizbuysell-run-policy.js";
import { fetchHtmlWithHttpWafPolicy } from "./fetch-with-waf-policy.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import { proxySessionKeyFromEnv } from "./proxy-config.js";
import { createRotatingHttpFetcher } from "./rotating-proxy-fetcher.js";
import { residentialProxyConfigured } from "./proxy-config.js";
import type { ListingIngestStateStore } from "./listing-ingest-state.js";
export type RunBizBuySellBrokerProfileScrapeOptions = Omit<
  RunBizBuySellScrapeOptions,
  "searchUrl" | "searchKeywords" | "discovery"
> & {
  profileUrl: string;
  /** Ingest active listings from profile (0 = none). */
  ingestLimit?: number;
  discoverOnly?: boolean;
  browserFetcher?: Fetcher;
  listingIngestState?: ListingIngestStateStore;
  ingestFailuresPath?: string;
  onProgress?: (ev: { phase: string; message: string }) => void;
};

export type RunBizBuySellBrokerProfileScrapeResult = {
  profileUrl: string;
  profile: BrokerProfileExtract;
  activeListingRefs: ListingRef[];
  listingsIngested: number;
  listingsFailed?: number;
  listingsSkippedKnown?: number;
  listingsSkippedFresh?: number;
  canonicalIds: string[];
  profileEvidenceKey: string;
};

export async function runBizBuySellBrokerProfileScrape(
  options: RunBizBuySellBrokerProfileScrapeOptions,
): Promise<RunBizBuySellBrokerProfileScrapeResult> {
  const profileUrl = options.profileUrl.trim();
  if (!isBizBuySellBrokerProfileUrl(profileUrl)) {
    throw new Error(`Not a BizBuySell broker profile URL: ${profileUrl}`);
  }
  assertBrokerProfileUrl(profileUrl);

  primeBizBuySellResidentialHosts();
  const browserFirst =
    Boolean(options.browserFetcher) && shouldUseBrowserFirstForBizBuySell();

  let fetcher: Fetcher;
  if (options.browserFetcher && browserFirst) {
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

  options.onProgress?.({
    phase: "fetch",
    message: `Fetching broker profile ${profileUrl}`,
  });

  const { body, finalUrl } = await fetchHtmlWithHttpWafPolicy(
    fetcher,
    profileUrl,
    wafPolicy,
  );
  const profile = parseBizBuySellBrokerProfilePage(body, finalUrl);
  const activeListingRefs = brokerProfileToRefs(profile.activeListings);

  const buf = Buffer.from(body, "utf8");
  const evidenceRef = await options.evidence.put(buf, {
    adapter: BIZBUYSELL_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: finalUrl,
  });

  if (options.discoverOnly || (options.ingestLimit ?? 0) === 0) {
    return {
      profileUrl: profile.profileUrl,
      profile,
      activeListingRefs,
      listingsIngested: 0,
      canonicalIds: [],
      profileEvidenceKey: evidenceRef.key,
    };
  }

  const ingestLimit = options.ingestLimit ?? activeListingRefs.length;
  const toIngest = activeListingRefs.slice(0, ingestLimit);
  const canonicalIds: string[] = [];
  const tracked = withCanonicalTracking(options, canonicalIds);
  const preferHttpIngest = shouldPreferHttpIngestForBizBuySell();

  options.onProgress?.({
    phase: "ingest",
    message: `Ingesting ${toIngest.length} active listing(s) from broker profile`,
  });

  const ingestStats = await ingestListingRefs(
    tracked,
    fetcher,
    listingIngestWafPolicy(wafPolicy),
    toIngest,
    toIngest.length,
    {
      useRotatingHttpWorkers: preferHttpIngest,
      sharedBrowserFetcher:
        !preferHttpIngest && browserFirst && options.browserFetcher
          ? options.browserFetcher
          : undefined,
    },
  );

  return {
    profileUrl: profile.profileUrl,
    profile,
    activeListingRefs,
    listingsIngested: ingestStats.listingsIngested,
    listingsFailed: ingestStats.listingsFailed,
    listingsSkippedKnown: ingestStats.listingsSkippedKnown,
    listingsSkippedFresh: ingestStats.listingsSkippedFresh,
    canonicalIds,
    profileEvidenceKey: evidenceRef.key,
  };
}
