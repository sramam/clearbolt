import type { Fetcher } from "./fetcher.js";
import {
  type RunLoopNetCatalogScrapeOptions,
  type RunLoopNetCatalogScrapeResult,
  runLoopNetCatalogScrape,
} from "./loopnet-catalog-scrape-pipeline.js";
import { createRotatingBrowserFetcher } from "./rotating-proxy-fetcher.js";

export type {
  RunLoopNetCatalogScrapeOptions,
  RunLoopNetCatalogScrapeResult,
} from "./loopnet-catalog-scrape-pipeline.js";

export interface RunLoopNetCatalogScrapeWithBrowserOptions
  extends RunLoopNetCatalogScrapeOptions {
  skipBrowser?: boolean;
  /** Show the Chromium window (`CLEARBOLT_BROWSER_HEADLESS=0`). */
  headed?: boolean;
}

/** CLI entry: Playwright is required for live LoopNet catalog pages (Akamai). */
export async function runLoopNetCatalogScrapeWithBrowser(
  options: RunLoopNetCatalogScrapeWithBrowserOptions,
): Promise<RunLoopNetCatalogScrapeResult> {
  const skipBrowser = options.skipBrowser ?? false;

  if (skipBrowser || options.browserFetcher) {
    return runLoopNetCatalogScrape(options);
  }

  const catalogHost = (() => {
    try {
      return new URL(options.catalogUrl).hostname;
    } catch {
      return "www.loopnet.com";
    }
  })();

  const rotatingBrowser = await createRotatingBrowserFetcher({
    workerIndex: 0,
    proxyHostHint: catalogHost,
    headless: options.headed ? false : undefined,
  });
  if (!rotatingBrowser) {
    throw new Error(
      "Playwright browser session failed to start (LoopNet catalog requires a browser). Run pnpm ensure:playwright, unset CLEARBOLT_SKIP_BROWSER=1, and retry.",
    );
  }
  try {
    return await runLoopNetCatalogScrape({
      ...options,
      browserFetcher: rotatingBrowser as Fetcher,
    });
  } finally {
    await rotatingBrowser.close();
  }
}
