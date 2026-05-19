import {
  type RunDealStreamCatalogScrapeOptions,
  type RunDealStreamCatalogScrapeResult,
  runDealStreamCatalogScrape,
} from "./dealstream-catalog-scrape-pipeline.js";
import type { Fetcher } from "./fetcher.js";
import { createRotatingBrowserFetcher } from "./rotating-proxy-fetcher.js";

export type {
  RunDealStreamCatalogScrapeOptions,
  RunDealStreamCatalogScrapeResult,
} from "./dealstream-catalog-scrape-pipeline.js";

export interface RunDealStreamCatalogScrapeWithBrowserOptions
  extends RunDealStreamCatalogScrapeOptions {
  skipBrowser?: boolean;
  /** Show the Chromium window (`CLEARBOLT_BROWSER_HEADLESS=0`). */
  headed?: boolean;
}

/** CLI entry: Playwright is required for live DealStream (DataDome). */
export async function runDealStreamCatalogScrapeWithBrowser(
  options: RunDealStreamCatalogScrapeWithBrowserOptions,
): Promise<RunDealStreamCatalogScrapeResult> {
  const skipBrowser = options.skipBrowser ?? false;

  if (skipBrowser || options.browserFetcher) {
    return runDealStreamCatalogScrape(options);
  }

  const catalogHost = (() => {
    try {
      return new URL(options.catalogUrl).hostname;
    } catch {
      return "dealstream.com";
    }
  })();

  const rotatingBrowser = await createRotatingBrowserFetcher({
    workerIndex: 0,
    proxyHostHint: catalogHost,
    headless: options.headed ? false : undefined,
  });
  if (!rotatingBrowser) {
    throw new Error(
      "Playwright browser session failed to start (DealStream catalog requires a browser). Run pnpm ensure:playwright, unset CLEARBOLT_SKIP_BROWSER=1, and retry.",
    );
  }
  try {
    return await runDealStreamCatalogScrape({
      ...options,
      browserFetcher: rotatingBrowser as Fetcher,
    });
  } finally {
    await rotatingBrowser.close();
  }
}
