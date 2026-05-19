import type { ListingRef } from "@clearbolt/core";
import * as cheerio from "cheerio";
import {
  extractListingIdFromDealStreamUrl,
  isDealStreamBrokerProfileUrl,
  normalizeDealStreamBrokerProfileUrl,
} from "../dealstream-broker-url.js";
import { listingRefFromDealStreamUrl } from "../dealstream-listing-url.js";

export type DealStreamBrokerListingCard = {
  title?: string;
  url: string;
  externalId?: string;
  price?: string;
  location?: string;
};

export type DealStreamBrokerProfileExtract = {
  profileUrl: string;
  name?: string;
  firm?: string;
  phone?: string;
  email?: string;
  about?: string;
  activeListings: DealStreamBrokerListingCard[];
};

function cardFromAnchor(
  $: cheerio.CheerioAPI,
  el: Parameters<cheerio.CheerioAPI>[0],
  base: URL,
): DealStreamBrokerListingCard | null {
  const a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
  const href = a.attr("href");
  if (!href) return null;
  const abs = new URL(href, base).toString();
  const ref = listingRefFromDealStreamUrl(abs);
  if (!ref) return null;
  const title =
    a.text().replace(/\s+/g, " ").trim() ||
    $(el).find("h2,h3,h4").first().text().trim();
  return {
    url: ref.url,
    externalId: ref.externalId,
    title: title || undefined,
  };
}

export function parseDealStreamBrokerProfilePage(
  html: string,
  url: string,
): DealStreamBrokerProfileExtract {
  const $ = cheerio.load(html);
  const base = new URL(url);
  const profileUrl = normalizeDealStreamBrokerProfileUrl(url) ?? url;

  const extract: DealStreamBrokerProfileExtract = {
    profileUrl,
    activeListings: [],
  };

  const name = $("h1").first().text().trim();
  if (name) extract.name = name;

  const about = $("main, article, .profile, .bio")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (about) extract.about = about.slice(0, 8000);

  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const card = cardFromAnchor($, el, base);
    if (!card?.externalId) return;
    const key = card.externalId;
    if (seen.has(key)) return;
    seen.add(key);
    extract.activeListings.push(card);
  });

  return extract;
}

export function brokerProfileToRefs(
  profile: DealStreamBrokerProfileExtract,
): ListingRef[] {
  return profile.activeListings
    .filter((c) => c.externalId)
    .map((c) => ({
      url: c.url,
      externalId: c.externalId,
    }));
}

export function isListingOnBrokerProfile(
  profile: DealStreamBrokerProfileExtract,
  listingId: string,
): boolean {
  return profile.activeListings.some((c) => c.externalId === listingId);
}

export function assertDealStreamBrokerProfileUrl(url: string): void {
  if (!isDealStreamBrokerProfileUrl(url)) {
    throw new Error(`not a DealStream broker profile URL: ${url}`);
  }
}

export { extractListingIdFromDealStreamUrl };
