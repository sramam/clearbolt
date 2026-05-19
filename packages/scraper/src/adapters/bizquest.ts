import type { ListingRef, ParsedListingFields } from "@clearbolt/core";
import * as cheerio from "cheerio";
import { listingRefFromBizQuestUrl } from "../bizquest-listing-url.js";
import {
  type BizQuestSavedSearchParams,
  buildBizQuestSearchPageUrl,
  parseBizQuestSearchPageNumber,
  parseBizQuestSearchUrl,
} from "../bizquest-search-url.js";
import { buildSourceRecord } from "./bizbuysell.js";
import {
  type BizQuestListingExtract,
  parseBizQuestListingPage,
} from "./bizquest-listing-parse.js";

export const BIZQUEST_ADAPTER_ID = "bizquest";

export {
  parseBizQuestSearchUrl,
  serializeBizQuestSearchUrl,
  buildBizQuestSearchPageUrl,
  isBizQuestSearchUrl,
} from "../bizquest-search-url.js";
export {
  listingRefFromBizQuestUrl,
  isBizQuestListingUrl,
} from "../bizquest-listing-url.js";

export function parseSearchUrl(url: string): BizQuestSavedSearchParams {
  return parseBizQuestSearchUrl(url);
}

function listingRefsFromSearchHtml(
  searchPageHtml: string,
  searchUrl: string,
): ListingRef[] {
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
    const ref = listingRefFromBizQuestUrl(abs.toString());
    if (!ref?.externalId) return;
    const key = `id:${ref.externalId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  });
  return refs;
}

export async function* discoverListingRefs(
  searchPageHtml: string,
  searchUrl: string,
): AsyncIterable<ListingRef> {
  for (const ref of listingRefsFromSearchHtml(searchPageHtml, searchUrl)) {
    yield ref;
  }
}

/** Next search results page, or null when pagination should stop. */
export function discoverNextSearchPageUrl(
  searchPageHtml: string,
  currentUrl: string,
): string | null {
  const $ = cheerio.load(searchPageHtml);
  const current = new URL(currentUrl);
  const page = parseBizQuestSearchPageNumber(current.pathname);
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const abs = new URL(href, current);
      if (!abs.hostname.includes("bizquest.com")) return;
      const nextPage = parseBizQuestSearchPageNumber(abs.pathname);
      if (nextPage === page + 1) found = abs.toString();
    } catch {
      /* ignore */
    }
  });
  if (found) return found;
  if (listingRefsFromSearchHtml(searchPageHtml, currentUrl).length === 0) {
    return null;
  }
  return buildBizQuestSearchPageUrl(currentUrl, page + 1);
}

export function parseListingPage(
  html: string,
  url: string,
): ParsedListingFields & { externalId?: string } {
  return toParsedListingFields(parseBizQuestListingPage(html, url));
}

export function toParsedListingFields(
  extract: BizQuestListingExtract,
): ParsedListingFields & { externalId?: string } {
  return {
    title: extract.title,
    askingPrice: extract.askingPrice,
    revenue: extract.revenue,
    cashFlow: extract.cashFlow,
    city: extract.city,
    state: extract.state,
    location: extract.location,
    industry: extract.industry,
    brokerName: extract.brokerName,
    description: extract.description,
    externalId: extract.externalId,
    listingId: extract.listingId ?? extract.externalId,
  };
}

export { buildSourceRecord };
