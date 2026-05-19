import {
  type RunBizQuestScrapeOptions,
  type RunBizQuestScrapeResult,
  runBizQuestScrape as runPipeline,
} from "./bizquest-scrape-pipeline.js";
import type { Fetcher } from "./fetcher.js";

export type {
  RunBizQuestScrapeOptions,
  RunBizQuestScrapeResult,
} from "./bizquest-scrape-pipeline.js";

export interface RunBizQuestScrapeWithBrowserOptions
  extends RunBizQuestScrapeOptions {
  skipBrowser?: boolean;
  headed?: boolean;
}

/** CLI entry: optionally opens Playwright for Akamai on bizquest.com. */
export async function runBizQuestScrape(
  options: RunBizQuestScrapeWithBrowserOptions,
): Promise<RunBizQuestScrapeResult> {
  const useFixtures = options.useFixtures ?? false;
  const skipBrowser = options.skipBrowser ?? false;

  if (useFixtures || skipBrowser || options.browserFetcher) {
    return runPipeline(options);
  }

  const { openBrowserSession } = await import("./browser-fetcher.js");
  const { proxySessionKeyFromEnv } = await import("./proxy-config.js");
  const searchHost = (() => {
    try {
      return new URL(options.searchUrl).hostname;
    } catch {
      return "www.bizquest.com";
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
