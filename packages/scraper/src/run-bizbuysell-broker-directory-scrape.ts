import type { EvidenceStore, MetadataStore } from "@clearbolt/storage";
import { rewriteBizBuySellToMobileUrl } from "./adapters/bizbuysell-mobile.js";
import { BIZBUYSELL_ADAPTER_ID } from "./adapters/bizbuysell.js";
import {
  discoverBrokerRefsFromBizBuySellDirectoryPage,
  discoverNextBizBuySellBrokerDirectoryPageUrl,
  isBizBuySellBrokerDirectoryUrl,
  recoverBrokerDirectoryPageUrl,
} from "./adapters/bizbuysell/broker-directory.js";
import { catalogPageFetchTargets } from "./bizbuysell-catalog-scrape-pipeline.js";
import {
  catalogDiscoveryWafPolicy,
  catalogPageGapMs,
  primeBizBuySellResidentialHosts,
  shouldUseBrowserFirstForBizBuySell,
} from "./bizbuysell-run-policy.js";
import type { BrokerDirectoryRef } from "./broker-directory-ref.js";
import { writeBrokerRefsFile } from "./broker-refs-file.js";
import { walkBrokerDirectoryPages } from "./discovery/broker-directory-walk.js";
import { fetchHtmlWithHttpWafPolicy } from "./fetch-with-waf-policy.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import type { Fetcher } from "./fetcher.js";
import { HttpFetcher } from "./http-fetcher.js";
import {
  proxySessionKeyFromEnv,
  residentialProxyConfigured,
} from "./proxy-config.js";
import { createRotatingHttpFetcher } from "./rotating-proxy-fetcher.js";
import { throttleHost } from "./throttle.js";

export type RunBizBuySellBrokerDirectoryScrapeOptions = {
  directoryUrl: string;
  evidence: EvidenceStore;
  metadata: MetadataStore;
  discoverOnly?: boolean;
  maxPages?: number;
  maxBrokers?: number;
  useFixtures?: boolean;
  browserFetcher?: Fetcher;
  brokerRefsCheckpointPath?: string;
  resumeDiscovery?: {
    refs: BrokerDirectoryRef[];
    startUrl: string;
    pagesFetched?: number;
  };
  onProgress?: (ev: {
    phase: "discovery";
    message: string;
    current?: number;
    total?: number;
  }) => void;
};

export type RunBizBuySellBrokerDirectoryScrapeResult = {
  directoryUrl: string;
  pagesFetched: number;
  brokersDiscovered: number;
  discoveredBrokerRefs: BrokerDirectoryRef[];
  evidenceKey: string;
};

async function collectBrokerRefsFromDirectory(
  fetcher: Fetcher,
  startUrl: string,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
  options: RunBizBuySellBrokerDirectoryScrapeOptions,
): Promise<{
  refs: BrokerDirectoryRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}> {
  const directoryBaseUrl = options.directoryUrl;
  const checkpointPath = options.brokerRefsCheckpointPath;
  const resume = options.resumeDiscovery;

  return walkBrokerDirectoryPages({
    startUrl: resume?.startUrl ?? startUrl,
    directoryBaseUrl,
    maxPages: options.maxPages ?? 0,
    maxBrokers: options.maxBrokers ?? 0,
    initialRefs: resume?.refs,
    resumeFromUrl: resume?.startUrl,
    initialPagesFetched: resume?.pagesFetched,
    isDirectoryUrl: isBizBuySellBrokerDirectoryUrl,
    recoverDirectoryPageUrl: recoverBrokerDirectoryPageUrl,
    fetchPage: async (url, ctx) => {
      await throttleHost(new URL(url).hostname, catalogPageGapMs());
      const alt =
        ctx.pageIndex === 0 && url.includes("www.bizbuysell.com")
          ? rewriteBizBuySellToMobileUrl(url)
          : undefined;
      const targets = catalogPageFetchTargets(url, alt);
      let lastErr: unknown;
      for (const target of targets) {
        try {
          const res = await fetchHtmlWithHttpWafPolicy(
            fetcher,
            target,
            wafPolicy,
          );
          return { body: res.body, finalUrl: res.finalUrl, status: res.status };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    },
    discoverRefs: discoverBrokerRefsFromBizBuySellDirectoryPage,
    discoverNext: (html, pageUrl, pageNum) =>
      discoverNextBizBuySellBrokerDirectoryPageUrl(html, pageUrl, {
        directoryBaseUrl,
        currentPageNumber: pageNum,
      }),
    onProgress: options.onProgress,
    onPageComplete: checkpointPath
      ? async ({ refs, pagesFetched, lastPageUrl, nextPageUrl }) => {
          await writeBrokerRefsFile(checkpointPath, {
            adapter: BIZBUYSELL_ADAPTER_ID,
            directoryUrl: directoryBaseUrl,
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

export async function runBizBuySellBrokerDirectoryScrape(
  options: RunBizBuySellBrokerDirectoryScrapeOptions,
): Promise<RunBizBuySellBrokerDirectoryScrapeResult> {
  const directoryUrl = options.directoryUrl.trim();
  if (!isBizBuySellBrokerDirectoryUrl(directoryUrl)) {
    throw new Error(
      `Not a BizBuySell broker directory URL (expected /business-brokers/…): ${directoryUrl}`,
    );
  }

  primeBizBuySellResidentialHosts();
  const browserFirst =
    Boolean(options.browserFetcher) && shouldUseBrowserFirstForBizBuySell();
  const fetchStart = rewriteBizBuySellToMobileUrl(directoryUrl);

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
  const wafPolicy = catalogDiscoveryWafPolicy({
    persistNeedsBrowser,
    hostRequiresBrowser,
    browserFetcher: options.browserFetcher,
    browserLanePrimary: browserFirst,
    proxySessionKey: proxySessionKeyFromEnv(),
    maxHttpAttempts: 4,
    throttleMsBetweenRetries: 3000,
  });

  const { refs, pagesFetched, lastPageUrl, lastHtml } =
    await collectBrokerRefsFromDirectory(
      fetcher,
      fetchStart,
      wafPolicy,
      options,
    );

  const buf = Buffer.from(lastHtml, "utf8");
  const evidenceRef = await options.evidence.put(buf, {
    adapter: BIZBUYSELL_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: lastPageUrl,
  });

  options.onProgress?.({
    phase: "discovery",
    message: `Broker discovery complete: ${refs.length} profile URL(s) from ${pagesFetched} page(s)`,
  });

  return {
    directoryUrl,
    pagesFetched,
    brokersDiscovered: refs.length,
    discoveredBrokerRefs: refs,
    evidenceKey: evidenceRef.key,
  };
}
