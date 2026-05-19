import {
  type RunBizBuySellCatalogScrapeOptions,
  type RunBizBuySellCatalogScrapeResult,
  runBizBuySellCatalogScrape,
} from "./bizbuysell-catalog-scrape-pipeline.js";
import {
  shouldPreferHttpIngestForBizBuySell,
  shouldUseBrowserFallbackForBizBuySellListingIngest,
  shouldUseBrowserFirstForBizBuySell,
} from "./bizbuysell-run-policy.js";
import type { Fetcher } from "./fetcher.js";
import { createRotatingBrowserFetcher } from "./rotating-proxy-fetcher.js";

export type {
  RunBizBuySellCatalogScrapeOptions,
  RunBizBuySellCatalogScrapeResult,
} from "./bizbuysell-catalog-scrape-pipeline.js";

export interface RunBizBuySellCatalogScrapeWithBrowserOptions
  extends RunBizBuySellCatalogScrapeOptions {
  skipBrowser?: boolean;
  /** Show the Chromium window (`CLEARBOLT_BROWSER_HEADLESS=0`). */
  headed?: boolean;
}

/** CLI / Fly entry: Playwright when HTTP is blocked (typical for www catalog pages). */
export async function runBizBuySellCatalogScrapeWithBrowser(
  options: RunBizBuySellCatalogScrapeWithBrowserOptions,
): Promise<RunBizBuySellCatalogScrapeResult> {
  const useFixtures = options.useFixtures ?? false;
  const skipBrowser = options.skipBrowser ?? false;
  const preferHttpIngest =
    options.preferHttpIngest ?? shouldPreferHttpIngestForBizBuySell();

  if (useFixtures || skipBrowser || options.browserFetcher) {
    return runBizBuySellCatalogScrape({
      ...options,
      preferHttpIngest,
    });
  }

  const { primeBizBuySellResidentialHosts } = await import(
    "./bizbuysell-run-policy.js"
  );
  primeBizBuySellResidentialHosts();
  const catalogHost = (() => {
    try {
      return new URL(options.catalogUrl).hostname;
    } catch {
      return "www.bizbuysell.com";
    }
  })();

  const browserFirst = shouldUseBrowserFirstForBizBuySell();
  const browserFallback =
    !browserFirst &&
    preferHttpIngest &&
    shouldUseBrowserFallbackForBizBuySellListingIngest();

  if (!browserFirst && !browserFallback) {
    return runBizBuySellCatalogScrape({
      ...options,
      preferHttpIngest,
    });
  }

  if (browserFirst) {
    const rotatingBrowser = await createRotatingBrowserFetcher({
      workerIndex: 0,
      proxyHostHint: catalogHost,
      headless: options.headed ? false : undefined,
    });
    if (!rotatingBrowser) {
      throw new Error(
        "Playwright browser session failed to start but CLEARBOLT_BIZBUYSELL_BROWSER_FIRST=1. Run pnpm ensure:playwright, unset CLEARBOLT_SKIP_BROWSER=1, and retry.",
      );
    }
    try {
      return await runBizBuySellCatalogScrape({
        ...options,
        browserFetcher: rotatingBrowser as Fetcher,
        preferHttpIngest,
      });
    } finally {
      await rotatingBrowser.close();
    }
  }

  console.log(
    "listing ingest: HTTP+proxy first; per-worker Playwright when a listing hits WAF",
  );
  return runBizBuySellCatalogScrape({
    ...options,
    preferHttpIngest,
    perWorkerListingBrowserFallback: true,
    listingBrowserFallbackHost: catalogHost,
    listingBrowserHeadless: options.headed ? false : undefined,
  });
}
