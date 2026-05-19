import { randomUUID } from "node:crypto";
import type {
  ListingRef,
  ParsedListingFields,
  ProcessedArtifacts,
  SourceRecord,
} from "@clearbolt/core";
import type { EvidenceRef } from "@clearbolt/core";
import * as cheerio from "cheerio";
import { listingRefFromBizBuySellUrl } from "../bizbuysell-listing-url.js";
import {
  shouldPreferMobileBizBuySellListing,
  shouldRetryBizBuySellListingOnDesktop,
} from "../bizbuysell-run-policy.js";
import {
  type FetchHtmlWithHttpWafPolicyOptions,
  fetchHtmlWithHttpWafPolicy,
} from "../fetch-with-waf-policy.js";
import type { Fetcher } from "../fetcher.js";
import {
  parseBizBuySellListingPage,
  toParsedListingFields,
} from "./bizbuysell-listing-parse.js";
import {
  rewriteBizBuySellToDesktopUrl,
  rewriteBizBuySellToMobileUrl,
} from "./bizbuysell-mobile.js";

export const BIZBUYSELL_ADAPTER_ID = "bizbuysell";

export function parseSearchUrl(url: string): { url: string } {
  new URL(url);
  return { url };
}

export async function* discoverListingRefs(
  searchPageHtml: string,
  searchUrl: string,
): AsyncIterable<ListingRef> {
  const $ = cheerio.load(searchPageHtml);
  const base = new URL(searchUrl);
  const seen = new Set<string>();
  const refs: ListingRef[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    const ref = listingRefFromBizBuySellUrl(abs.toString());
    if (!ref?.externalId) return;
    const key = `id:${ref.externalId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  });
  for (const ref of refs) {
    yield ref;
  }
}

/** Single HTTP fetch (tests, replay, callers that skip WAF policy). */
export async function fetchListingHtml(
  fetcher: Fetcher,
  ref: ListingRef,
): Promise<{ html: string; finalUrl: string }> {
  const res = await fetcher.fetch({ url: ref.url });
  return { html: res.body, finalUrl: res.finalUrl };
}

export type FetchListingHtmlWithWafPolicyOptions =
  FetchHtmlWithHttpWafPolicyOptions & {
    /** `--retry-failures-only`: try www before m. (failures were often m. blocks). */
    desktopFirst?: boolean;
  };

/** Listing detail URL for fetch (m. when proxy/browser paths prefer mobile). */
export function bizBuySellListingFetchUrl(url: string): string {
  const canonical = rewriteBizBuySellToDesktopUrl(url);
  return shouldPreferMobileBizBuySellListing()
    ? rewriteBizBuySellToMobileUrl(canonical)
    : canonical;
}

async function fetchListingHtmlAtUrl(
  fetcher: Fetcher,
  fetchUrl: string,
  options: FetchListingHtmlWithWafPolicyOptions,
): Promise<{ html: string; finalUrl: string }> {
  const res = await fetchHtmlWithHttpWafPolicy(fetcher, fetchUrl, options);
  return {
    html: res.body,
    finalUrl: rewriteBizBuySellToDesktopUrl(res.finalUrl || fetchUrl),
  };
}

async function tryBrowserListingFetch(
  browserFetcher: Fetcher,
  canonicalUrl: string,
  options: FetchListingHtmlWithWafPolicyOptions,
  listingId: string,
): Promise<{ html: string; finalUrl: string } | null> {
  if (!browserFetcher) return null;
  try {
    if (process.env.CLEARBOLT_PROXY_ROTATION_LOG === "1") {
      console.log(
        `[ingest] HTTP blocked for ${listingId}; trying Playwright on www`,
      );
    }
    return await fetchListingHtmlAtUrl(browserFetcher, canonicalUrl, {
      ...options,
      browserLanePrimary: true,
      browserFetcher: undefined,
    });
  } catch {
    return null;
  }
}

/**
 * Listing detail fetch with bounded HTTP + WAF policy.
 * Default: m. then www fallback. `desktopFirst`: www then m. (retry-failures-only).
 * After HTTP lanes fail, optional Playwright on www when `browserFetcher` is set.
 */
export async function fetchListingHtmlWithWafPolicy(
  fetcher: Fetcher,
  ref: ListingRef,
  options: FetchListingHtmlWithWafPolicyOptions,
): Promise<{ html: string; finalUrl: string }> {
  const canonicalUrl = rewriteBizBuySellToDesktopUrl(ref.url);
  const mobileUrl = rewriteBizBuySellToMobileUrl(canonicalUrl);
  const listingId = ref.externalId ?? canonicalUrl;
  const preferMobile = shouldPreferMobileBizBuySellListing();
  const desktopFirst = options.desktopFirst === true;

  const attemptAlternateHost = async (
    primaryErr: unknown,
    alternateUrl: string,
    label: string,
  ): Promise<{ html: string; finalUrl: string }> => {
    if (!shouldRetryBizBuySellListingOnDesktop(primaryErr)) {
      throw primaryErr;
    }
    if (process.env.CLEARBOLT_SCRAPER_DEBUG === "1") {
      const msg =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      console.error(
        `[scraper] ${label} listing fetch failed for ${listingId} (${msg.slice(0, 100)}); retrying ${alternateUrl.includes("m.bizbuysell") ? "m." : "www"}`,
      );
    }
    return fetchListingHtmlAtUrl(fetcher, alternateUrl, options);
  };

  const primaryUrl = desktopFirst
    ? canonicalUrl
    : preferMobile
      ? mobileUrl
      : canonicalUrl;
  const alternateUrl = desktopFirst ? mobileUrl : canonicalUrl;

  if (primaryUrl === alternateUrl) {
    try {
      return await fetchListingHtmlAtUrl(fetcher, primaryUrl, options);
    } catch (err) {
      const browser = await tryBrowserListingFetch(
        options.browserFetcher ?? fetcher,
        canonicalUrl,
        options,
        listingId,
      );
      if (browser) return browser;
      throw err;
    }
  }

  try {
    return await fetchListingHtmlAtUrl(fetcher, primaryUrl, options);
  } catch (primaryErr) {
    try {
      return await attemptAlternateHost(
        primaryErr,
        alternateUrl,
        desktopFirst ? "www" : "m.",
      );
    } catch (alternateErr) {
      const browser = await tryBrowserListingFetch(
        options.browserFetcher ?? fetcher,
        canonicalUrl,
        options,
        listingId,
      );
      if (browser) return browser;
      throw alternateErr;
    }
  }
}

export function parseListingPage(
  html: string,
  url: string,
): ParsedListingFields & { externalId?: string } {
  return toParsedListingFields(parseBizBuySellListingPage(html, url));
}

export function buildSourceRecord(input: {
  url: string;
  adapter: string;
  parsed: ParsedListingFields & { externalId?: string };
  /** Listing number; wins over parsed fields (catalog ref, canonical URL). */
  externalId?: string;
  evidenceRef: EvidenceRef;
  processedArtifacts?: ProcessedArtifacts;
  bodyFingerprint?: string;
  bodyEmbedding?: number[];
  bodyEmbeddingModel?: string;
}): SourceRecord {
  const now = new Date().toISOString();
  const externalId =
    input.externalId ?? input.parsed.externalId ?? input.parsed.listingId;
  return {
    id: randomUUID(),
    adapter: input.adapter,
    url: input.url,
    externalId,
    canonicalDealId: null,
    evidenceRef: input.evidenceRef,
    processedArtifacts: input.processedArtifacts,
    parsedFields: {
      title: input.parsed.title,
      askingPrice: input.parsed.askingPrice,
      revenue: input.parsed.revenue,
      cashFlow: input.parsed.cashFlow,
      ebitda: input.parsed.ebitda,
      city: input.parsed.city,
      state: input.parsed.state,
      stateName: input.parsed.stateName,
      location: input.parsed.location,
      industry: input.parsed.industry,
      brokerName: input.parsed.brokerName,
      brokerProfileUrl: input.parsed.brokerProfileUrl,
      listingId: externalId ?? input.parsed.listingId,
      yearEstablished: input.parsed.yearEstablished,
      status: input.parsed.status,
      category: input.parsed.category,
      categories: input.parsed.categories,
      description: input.parsed.description,
    },
    bodyFingerprint: input.bodyFingerprint,
    bodyEmbedding: input.bodyEmbedding,
    bodyEmbeddingModel: input.bodyEmbeddingModel,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
