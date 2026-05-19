import type { WebBizBuySellScrapeInput, WebBizBuySellScrapeResult } from "@/lib/bizbuysell-scrape-types";
import type { ScrapeProgressEvent } from "@/lib/bizbuysell-scrape-types";

export function scraperServiceUrlFromEnv(): string | null {
  const url = process.env.CLEARBOLT_SCRAPER_SERVICE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

function scraperServiceSecret(): string | undefined {
  return process.env.CLEARBOLT_SCRAPER_SERVICE_SECRET?.trim() || undefined;
}

/**
 * Run BizBuySell scrape on the Fly.io scraper service (or local `pnpm scraper-service:dev`).
 */
export async function runBizBuySellScrapeViaService(
  input: WebBizBuySellScrapeInput,
  onProgress?: (event: ScrapeProgressEvent) => void,
): Promise<WebBizBuySellScrapeResult> {
  const base = scraperServiceUrlFromEnv();
  if (!base) {
    throw new Error(
      "CLEARBOLT_SCRAPER_SERVICE_URL is not set. Run `pnpm scraper-service:dev` locally or deploy apps/scraper-service to Fly.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = scraperServiceSecret();
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(`${base}/v1/bizbuysell/scrape`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      searchUrl: input.searchUrl,
      searchKeywords: input.searchKeywords,
      limit: input.limit,
      useFixtures: input.useFixtures,
      discovery: input.discovery,
      skipBrowser: input.skipBrowser,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text || `Scraper service failed (${res.status})`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: WebBizBuySellScrapeResult | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.step === "result") {
        result = {
          listingsIngested: Number(parsed.listingsIngested ?? 0),
          searchEvidenceKey: String(parsed.searchEvidenceKey ?? ""),
          effectiveSearchUrl: String(parsed.effectiveSearchUrl ?? ""),
          discoveryMode: parsed.discoveryMode as WebBizBuySellScrapeResult["discoveryMode"],
          canonicalIds: Array.isArray(parsed.canonicalIds)
            ? (parsed.canonicalIds as string[])
            : [],
        };
      } else if (
        typeof parsed.step === "string" &&
        typeof parsed.message === "string" &&
        parsed.step !== "done" &&
        parsed.step !== "start"
      ) {
        onProgress?.({
          phase: String(parsed.step),
          message: parsed.message,
          current:
            typeof parsed.current === "number" ? parsed.current : undefined,
          total: typeof parsed.total === "number" ? parsed.total : undefined,
        });
      } else if (parsed.step === "error") {
        throw new Error(String(parsed.message ?? "scrape_failed"));
      }
    }
  }

  if (!result) {
    throw new Error("Scraper service returned no result payload");
  }
  return result;
}
