import {
  runBizBuySellBrokerProfileScrape,
  type RunBizBuySellBrokerProfileScrapeOptions,
  type RunBizBuySellBrokerProfileScrapeResult,
} from "./run-bizbuysell-broker-profile-scrape.js";
import {
  primeBizBuySellResidentialHosts,
  shouldUseBrowserFirstForBizBuySell,
} from "./bizbuysell-run-policy.js";
import type { Fetcher } from "./fetcher.js";
import { createRotatingBrowserFetcher } from "./rotating-proxy-fetcher.js";

export type {
  RunBizBuySellBrokerProfileScrapeOptions,
  RunBizBuySellBrokerProfileScrapeResult,
};

export type RunBizBuySellBrokerProfileScrapeWithBrowserOptions =
  RunBizBuySellBrokerProfileScrapeOptions & {
    skipBrowser?: boolean;
    headed?: boolean;
  };

export async function runBizBuySellBrokerProfileScrapeWithBrowser(
  options: RunBizBuySellBrokerProfileScrapeWithBrowserOptions,
): Promise<RunBizBuySellBrokerProfileScrapeResult> {
  const skipBrowser = options.skipBrowser ?? false;
  if (skipBrowser || options.browserFetcher) {
    return runBizBuySellBrokerProfileScrape(options);
  }
  if (!shouldUseBrowserFirstForBizBuySell()) {
    return runBizBuySellBrokerProfileScrape(options);
  }

  primeBizBuySellResidentialHosts();
  const host = (() => {
    try {
      return new URL(options.profileUrl).hostname;
    } catch {
      return "www.bizbuysell.com";
    }
  })();

  const rotatingBrowser = await createRotatingBrowserFetcher({
    workerIndex: 0,
    proxyHostHint: host,
    headless: options.headed ? false : undefined,
  });
  if (!rotatingBrowser) {
    return runBizBuySellBrokerProfileScrape(options);
  }

  try {
    return await runBizBuySellBrokerProfileScrape({
      ...options,
      browserFetcher: rotatingBrowser as Fetcher,
    });
  } finally {
    await rotatingBrowser.close();
  }
}
