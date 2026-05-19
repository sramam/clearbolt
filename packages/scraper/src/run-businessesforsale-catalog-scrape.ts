import {
  type RunBusinessesForSaleCatalogScrapeOptions,
  type RunBusinessesForSaleCatalogScrapeResult,
  runBusinessesForSaleCatalogScrape,
} from "./businessesforsale-catalog-scrape-pipeline.js";
import type { Fetcher } from "./fetcher.js";
import { createRotatingBrowserFetcher } from "./rotating-proxy-fetcher.js";

export type {
  RunBusinessesForSaleCatalogScrapeOptions,
  RunBusinessesForSaleCatalogScrapeResult,
} from "./businessesforsale-catalog-scrape-pipeline.js";

export interface RunBusinessesForSaleCatalogScrapeWithBrowserOptions
  extends RunBusinessesForSaleCatalogScrapeOptions {
  skipBrowser?: boolean;
  /** Show the Chromium window (`CLEARBOLT_BROWSER_HEADLESS=0`). */
  headed?: boolean;
}

/** CLI entry: Playwright is required for live BusinessesForSale (Cloudflare). */
export async function runBusinessesForSaleCatalogScrapeWithBrowser(
  options: RunBusinessesForSaleCatalogScrapeWithBrowserOptions,
): Promise<RunBusinessesForSaleCatalogScrapeResult> {
  const skipBrowser = options.skipBrowser ?? false;

  if (skipBrowser || options.browserFetcher) {
    return runBusinessesForSaleCatalogScrape(options);
  }

  const catalogHost = (() => {
    try {
      return new URL(options.catalogUrl).hostname;
    } catch {
      return "us.businessesforsale.com";
    }
  })();

  const rotatingBrowser = await createRotatingBrowserFetcher({
    workerIndex: 0,
    proxyHostHint: catalogHost,
    headless: options.headed ? false : undefined,
  });
  if (!rotatingBrowser) {
    throw new Error(
      "Playwright browser session failed to start (BusinessesForSale catalog requires a browser). Run pnpm ensure:playwright, unset CLEARBOLT_SKIP_BROWSER=1, and retry.",
    );
  }
  try {
    return await runBusinessesForSaleCatalogScrape({
      ...options,
      browserFetcher: rotatingBrowser as Fetcher,
    });
  } finally {
    await rotatingBrowser.close();
  }
}
