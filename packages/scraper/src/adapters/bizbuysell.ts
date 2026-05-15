import { randomUUID } from "node:crypto";
import type {
  ListingRef,
  ParsedListingFields,
  SourceRecord,
} from "@clearbolt/core";
import type { EvidenceRef } from "@clearbolt/core";
import * as cheerio from "cheerio";
import {
  type FetchHtmlWithHttpWafPolicyOptions,
  fetchHtmlWithHttpWafPolicy,
} from "../fetch-with-waf-policy.js";
import type { Fetcher } from "../fetcher.js";

export const BIZBUYSELL_ADAPTER_ID = "bizbuysell";

export function parseSearchUrl(url: string): { url: string } {
  new URL(url);
  return { url };
}

function extractListingIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/(\d{6,})/);
  return m?.[1];
}

export async function* discoverListingRefs(
  searchPageHtml: string,
  searchUrl: string,
): AsyncIterable<ListingRef> {
  const $ = cheerio.load(searchPageHtml);
  const base = new URL(searchUrl);
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (!abs.hostname.includes("bizbuysell")) return;
    const externalId = extractListingIdFromPath(abs.pathname);
    if (!externalId) return;
    abs.hash = "";
    const key = abs.toString();
    if (!seen.has(key)) seen.add(key);
  });
  for (const url of seen) {
    const u = new URL(url);
    yield { url, externalId: extractListingIdFromPath(u.pathname) };
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
  FetchHtmlWithHttpWafPolicyOptions;

/** Listing detail fetch with the same bounded HTTP + WAF policy as search. */
export async function fetchListingHtmlWithWafPolicy(
  fetcher: Fetcher,
  ref: ListingRef,
  options: FetchListingHtmlWithWafPolicyOptions,
): Promise<{ html: string; finalUrl: string }> {
  const res = await fetchHtmlWithHttpWafPolicy(fetcher, ref.url, options);
  return { html: res.body, finalUrl: res.finalUrl };
}

export function parseListingPage(
  html: string,
  url: string,
): ParsedListingFields & { externalId?: string } {
  const $ = cheerio.load(html);
  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim().split("|")[0]?.trim() ||
    "";
  let askingPrice: number | undefined;
  const priceText = $("[class*='price'], .asking-price, .business-price")
    .first()
    .text()
    .replace(/[$,]/g, "")
    .trim();
  const pn = Number.parseFloat(priceText);
  if (!Number.isNaN(pn)) askingPrice = pn;

  const u = new URL(url);
  return {
    title: title || undefined,
    askingPrice,
    listingId: extractListingIdFromPath(u.pathname),
    externalId: extractListingIdFromPath(u.pathname),
  };
}

export function buildSourceRecord(input: {
  url: string;
  adapter: string;
  parsed: ParsedListingFields & { externalId?: string };
  evidenceRef: EvidenceRef;
}): SourceRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    adapter: input.adapter,
    url: input.url,
    externalId: input.parsed.externalId ?? input.parsed.listingId,
    canonicalDealId: null,
    evidenceRef: input.evidenceRef,
    parsedFields: {
      title: input.parsed.title,
      askingPrice: input.parsed.askingPrice,
      revenue: input.parsed.revenue,
      cashFlow: input.parsed.cashFlow,
      city: input.parsed.city,
      state: input.parsed.state,
      industry: input.parsed.industry,
      brokerName: input.parsed.brokerName,
      listingId: input.parsed.listingId,
    },
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
