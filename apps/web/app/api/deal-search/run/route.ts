import { getSessionContext } from "@/lib/auth-session";
import { runBizBuySellScrapeWithBrowser } from "@/lib/bizbuysell-scrape";
import { buildSearchHref } from "@/lib/search-url";
import { databaseUrlFromEnv } from "@clearbolt/db";
import {
  expandSearchQueryWithLlm,
  mergeRelaxedFtsQuery,
  prepareSearchQuery,
} from "@clearbolt/search";
import { buildBizBuySellSearchUrl } from "@clearbolt/scraper/bizbuysell-search-url";
import { serperApiKeyFromEnv } from "@clearbolt/scraper/serper-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProgressLine = {
  step: string;
  message: string;
  detail?: string;
  current?: number;
  total?: number;
};

function ndjson(line: ProgressLine): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(line)}\n`);
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSessionContext();
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
    });
  }

  const body = (await req.json()) as {
    q?: string;
    source?: string;
    view?: string;
  };
  const rawQ = body.q?.trim() ?? "";
  const source = body.source?.trim() || "all";
  const view = body.view === "list" ? "list" : "grid";

  const stream = new ReadableStream({
    async start(controller) {
      const push = (line: ProgressLine) => controller.enqueue(ndjson(line));

      try {
        if (!rawQ) {
          push({ step: "done", message: "Empty query", detail: "/search" });
          controller.close();
          return;
        }

        push({ step: "prepare", message: "Understanding your search…" });
        const prepared = prepareSearchQuery(rawQ);
        if (prepared.expansions.length > 0) {
          push({
            step: "prepare",
            message: "Normalized query",
            detail: prepared.expansions.join(" · "),
          });
        }

        if (databaseUrlFromEnv() === null) {
          const href = buildSearchHref({
            source,
            view,
            query: rawQ,
            extra: { scrapeError: "no_database" },
          });
          push({ step: "done", message: "No database configured", detail: href });
          controller.close();
          return;
        }

        const disableScrape = process.env.CLEARBOLT_DISABLE_WEB_SCRAPE === "1";
        const scrapeBizBuySell =
          !disableScrape &&
          (source === "all" || source === "" || source === "bizbuysell");

        const extra: Record<string, string> = {};
        if (prepared.didExpand) extra.expanded = "1";
        extra.relaxedFts = prepared.ftsQueryRelaxed;

        const llmPromise = expandSearchQueryWithLlm(prepared).then((llm) => {
          if (llm) {
            push({
              step: "ai",
              message: llm.note,
              detail: llm.synonyms.join(", "),
            });
            extra.llmSyn = llm.synonyms.join(",");
            extra.relaxedFts = mergeRelaxedFtsQuery(prepared, llm);
          } else {
            push({
              step: "ai",
              message: "Using keyword search (AI expansion off or unavailable)",
            });
          }
          return llm;
        });

        const scrapePromise =
          scrapeBizBuySell && prepared.searchKeywords
            ? (async () => {
                push({
                  step: "discover",
                  message: "Finding BizBuySell listings…",
                  detail: prepared.searchKeywords,
                });
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
                  const result = await runBizBuySellScrapeWithBrowser(
                    {
                      searchUrl,
                      searchKeywords: prepared.searchKeywords,
                      limit,
                      useFixtures,
                    },
                    (ev) => {
                      push({
                        step: ev.phase,
                        message: ev.message,
                        current: ev.current,
                        total: ev.total,
                      });
                    },
                  );
                  extra.scraped = String(result.listingsIngested);
                  extra.discovery = result.discoveryMode;
                  if (result.canonicalIds.length > 0) {
                    extra.ingested = result.canonicalIds.join(",");
                  }
                  push({
                    step: "ingest",
                    message: `Saved ${result.listingsIngested} listing(s) to your corpus`,
                  });
                  return result;
                } catch (e) {
                  const message =
                    e instanceof Error ? e.message : "scrape_failed";
                  if (
                    message.includes("Not enough credits") &&
                    serperApiKeyFromEnv() &&
                    !useFixtures
                  ) {
                    push({
                      step: "discover",
                      message: "Serper credits low — trying direct discovery…",
                    });
                    const fallback = await runBizBuySellScrapeWithBrowser(
                      {
                        searchUrl,
                        searchKeywords: prepared.searchKeywords,
                        limit,
                        useFixtures,
                        discovery: "direct",
                      },
                      (ev) =>
                        push({
                          step: ev.phase,
                          message: ev.message,
                          current: ev.current,
                          total: ev.total,
                        }),
                    );
                    extra.scraped = String(fallback.listingsIngested);
                    extra.discovery = "direct";
                    extra.scrapeNote = "serper_credits_exhausted";
                    if (fallback.canonicalIds.length > 0) {
                      extra.ingested = fallback.canonicalIds.join(",");
                    }
                    return fallback;
                  }
                  extra.scrapeError = message.slice(0, 200);
                  push({ step: "error", message });
                  return null;
                }
              })()
            : Promise.resolve(null);

        await Promise.all([llmPromise, scrapePromise]);

        push({ step: "rank", message: "Ranking matches in your deal corpus…" });
        const href = buildSearchHref({
          source,
          view,
          query: rawQ,
          extra,
        });
        push({ step: "done", message: "Opening results", detail: href });
      } catch (e) {
        const message = e instanceof Error ? e.message : "search_failed";
        push({ step: "error", message });
        push({
          step: "done",
          message: "Failed",
          detail: buildSearchHref({
            source,
            view,
            query: rawQ,
            extra: { scrapeError: message.slice(0, 200) },
          }),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
