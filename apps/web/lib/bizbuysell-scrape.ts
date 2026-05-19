import type {
  ScrapeProgressEvent,
  WebBizBuySellScrapeInput,
  WebBizBuySellScrapeResult,
} from "@/lib/bizbuysell-scrape-types";
import {
  runBizBuySellScrapeViaService,
  scraperServiceUrlFromEnv,
} from "@/lib/scraper-service-client";

export type {
  ScrapeProgressEvent,
  WebBizBuySellScrapeInput,
  WebBizBuySellScrapeResult,
} from "@/lib/bizbuysell-scrape-types";

/**
 * BizBuySell scrape for the web app — always via the Fly/local scraper HTTP service
 * (`CLEARBOLT_SCRAPER_SERVICE_URL`), not child_process.
 */
export async function runBizBuySellScrapeWithBrowser(
  input: WebBizBuySellScrapeInput,
  onProgress?: (event: ScrapeProgressEvent) => void,
): Promise<WebBizBuySellScrapeResult> {
  if (!scraperServiceUrlFromEnv()) {
    throw new Error(
      "Set CLEARBOLT_SCRAPER_SERVICE_URL (e.g. http://127.0.0.1:8791). Start the service with `pnpm scraper-service:dev`.",
    );
  }
  return runBizBuySellScrapeViaService(input, onProgress);
}
