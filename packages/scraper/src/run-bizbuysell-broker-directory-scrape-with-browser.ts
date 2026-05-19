import {
  primeBizBuySellResidentialHosts,
  shouldUseBrowserFirstForBizBuySell,
} from "./bizbuysell-run-policy.js";
import type { Fetcher } from "./fetcher.js";
import { createRotatingBrowserFetcher } from "./rotating-proxy-fetcher.js";
import {
  type RunBizBuySellBrokerDirectoryScrapeOptions,
  type RunBizBuySellBrokerDirectoryScrapeResult,
  runBizBuySellBrokerDirectoryScrape,
} from "./run-bizbuysell-broker-directory-scrape.js";

export type {
  RunBizBuySellBrokerDirectoryScrapeOptions,
  RunBizBuySellBrokerDirectoryScrapeResult,
};

export type RunBizBuySellBrokerDirectoryScrapeWithBrowserOptions =
  RunBizBuySellBrokerDirectoryScrapeOptions & {
    skipBrowser?: boolean;
    headed?: boolean;
  };

export async function runBizBuySellBrokerDirectoryScrapeWithBrowser(
  options: RunBizBuySellBrokerDirectoryScrapeWithBrowserOptions,
): Promise<RunBizBuySellBrokerDirectoryScrapeResult> {
  const skipBrowser = options.skipBrowser ?? false;

  if (skipBrowser || options.browserFetcher) {
    return runBizBuySellBrokerDirectoryScrape(options);
  }

  if (!shouldUseBrowserFirstForBizBuySell()) {
    return runBizBuySellBrokerDirectoryScrape(options);
  }

  primeBizBuySellResidentialHosts();
  const host = (() => {
    try {
      return new URL(options.directoryUrl).hostname;
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
    return runBizBuySellBrokerDirectoryScrape(options);
  }

  try {
    return await runBizBuySellBrokerDirectoryScrape({
      ...options,
      browserFetcher: rotatingBrowser as Fetcher,
    });
  } finally {
    await rotatingBrowser.close();
  }
}
