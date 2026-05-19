import type { ListingRef, ParsedListingFields } from "@clearbolt/core";
import * as cheerio from "cheerio";
import {
  fetchHtmlWithHttpWafPolicy,
  type FetchHtmlWithHttpWafPolicyOptions,
} from "../fetch-with-waf-policy.js";
import type { Fetcher } from "../fetcher.js";
import { listingRefFromDealStreamUrl } from "../dealstream-listing-url.js";
import { enrichListingExtract } from "./dealstream-listing-enrich.js";
import {
  parseDealStreamListingPage,
  toParsedListingFields,
} from "./dealstream-listing-parse.js";
import { buildSourceRecord } from "./bizbuysell.js";

export const DEALSTREAM_ADAPTER_ID = "dealstream";

export { buildSourceRecord, toParsedListingFields };

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
    try {
      const ref = listingRefFromDealStreamUrl(new URL(href, base).toString());
      if (!ref?.externalId) return;
      const key = `id:${ref.externalId}`;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push(ref);
    } catch {
      /* ignore */
    }
  });
  for (const ref of refs) {
    yield ref;
  }
}

export async function fetchListingHtmlWithWafPolicy(
  fetcher: Fetcher,
  ref: ListingRef,
  options: FetchHtmlWithHttpWafPolicyOptions,
): Promise<{ html: string; finalUrl: string }> {
  const res = await fetchHtmlWithHttpWafPolicy(fetcher, ref.url, options);
  return { html: res.body, finalUrl: res.finalUrl || ref.url };
}

export function parseListingPage(
  html: string,
  url: string,
): ParsedListingFields & { externalId?: string } {
  return toParsedListingFields(parseDealStreamListingPage(html, url));
}

export async function parseAndEnrichListingPage(
  html: string,
  url: string,
  ctx: {
    fetcher: Fetcher;
    wafPolicy: FetchHtmlWithHttpWafPolicyOptions;
  },
): Promise<ReturnType<typeof parseDealStreamListingPage>> {
  const extract = parseDealStreamListingPage(html, url);
  await enrichListingExtract(extract, html, ctx);
  return extract;
}
