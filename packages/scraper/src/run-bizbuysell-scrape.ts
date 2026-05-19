import {
  type RunBizBuySellScrapeOptions as PipelineOptions,
  type RunBizBuySellScrapeResult,
  runBizBuySellScrape as runPipeline,
} from "./bizbuysell-scrape-pipeline.js";
import type { Fetcher } from "./fetcher.js";

export type {
  RunBizBuySellScrapeOptions,
  RunBizBuySellScrapeResult,
} from "./bizbuysell-scrape-pipeline.js";

export interface RunBizBuySellScrapeWithBrowserOptions extends PipelineOptions {
  skipBrowser?: boolean;
  headed?: boolean;
}

/** CLI entry: optionally opens Playwright for WAF escalation. */
export async function runBizBuySellScrape(
  options: RunBizBuySellScrapeWithBrowserOptions,
): Promise<RunBizBuySellScrapeResult> {
  const useFixtures = options.useFixtures ?? false;
  const skipBrowser = options.skipBrowser ?? false;

  if (useFixtures || skipBrowser || options.browserFetcher) {
    return runPipeline(options);
  }

  const { openBrowserSession } = await import("./browser-fetcher.js");
  const { primeBizBuySellResidentialHosts } = await import(
    "./bizbuysell-run-policy.js"
  );
  const { proxySessionKeyFromEnv } = await import("./proxy-config.js");
  primeBizBuySellResidentialHosts();
  const searchHost = (() => {
    try {
      return new URL(options.searchUrl).hostname;
    } catch {
      return "www.bizbuysell.com";
    }
  })();
  const browserSession = await openBrowserSession({
    proxyHostHint: searchHost,
    sessionKey: proxySessionKeyFromEnv(),
    headless: options.headed ? false : undefined,
  });
  if (!browserSession) {
    return runPipeline(options);
  }
  try {
    return await runPipeline({
      ...options,
      browserFetcher: browserSession.fetcher as Fetcher,
    });
  } finally {
    await browserSession.close();
  }
}
