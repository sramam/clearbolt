"use server";

import { requireSessionOrRedirect } from "@/lib/auth-session";
import { runBizBuySellScrapeWithBrowser } from "@/lib/bizbuysell-scrape";
import { buildSearchHref } from "@/lib/search-url";
import { databaseUrlFromEnv } from "@clearbolt/db";
import { buildBizBuySellSearchUrl } from "@clearbolt/scraper/bizbuysell-search-url";
import { serperApiKeyFromEnv } from "@clearbolt/scraper/serper-client";
import { prepareSearchQuery } from "@clearbolt/search";
import { redirect } from "next/navigation";

/** One search: expand query → fetch BizBuySell → redirect to FTS-ranked results. */
export async function runDealSearch(formData: FormData): Promise<void> {
  await requireSessionOrRedirect("/search");

  const rawQ = formData.get("q")?.toString().trim() ?? "";
  const source = formData.get("source")?.toString().trim() || "all";
  const view = formData.get("view")?.toString().trim() || "grid";

  if (!rawQ) {
    redirect(buildSearchHref({ source, view, query: "" }));
  }

  const prepared = prepareSearchQuery(rawQ);
  const extra: Record<string, string> = {};
  if (prepared.didExpand) {
    extra.expanded = "1";
  }

  if (databaseUrlFromEnv() === null) {
    redirect(
      buildSearchHref({
        source,
        view,
        query: rawQ,
        extra: { ...extra, scrapeError: "no_database" },
      }),
    );
  }

  const disableScrape = process.env.CLEARBOLT_DISABLE_WEB_SCRAPE === "1";
  const scrapeBizBuySell =
    !disableScrape &&
    (source === "all" || source === "" || source === "bizbuysell");

  if (scrapeBizBuySell && prepared.searchKeywords) {
    const searchUrl = buildBizBuySellSearchUrl({
      keywords: prepared.searchKeywords,
    });
    const limit = Number.parseInt(
      process.env.CLEARBOLT_SCRAPE_LIMIT ?? "10",
      10,
    );
    const useFixtures =
      process.env.CLEARBOLT_SCRAPE_FIXTURES === "1" ||
      process.env.CLEARBOLT_USE_FIXTURES === "1";

    try {
      const result = await runBizBuySellScrapeWithBrowser({
        searchUrl,
        searchKeywords: prepared.searchKeywords,
        limit,
        useFixtures,
      });
      extra.scraped = String(result.listingsIngested);
      extra.discovery = result.discoveryMode;
    } catch (e) {
      const message = e instanceof Error ? e.message : "scrape_failed";
      if (
        message.includes("Not enough credits") &&
        serperApiKeyFromEnv() &&
        !useFixtures
      ) {
        try {
          const fallback = await runBizBuySellScrapeWithBrowser({
            searchUrl,
            searchKeywords: prepared.searchKeywords,
            limit,
            useFixtures,
            discovery: "direct",
          });
          extra.scraped = String(fallback.listingsIngested);
          extra.discovery = "direct";
          extra.scrapeNote = "serper_credits_exhausted";
        } catch (fallbackErr) {
          extra.scrapeError = (
            fallbackErr instanceof Error ? fallbackErr.message : message
          ).slice(0, 200);
        }
      } else {
        extra.scrapeError = message.slice(0, 200);
      }
    }
  }

  redirect(buildSearchHref({ source, view, query: rawQ, extra }));
}
