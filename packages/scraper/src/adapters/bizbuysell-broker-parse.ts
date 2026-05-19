import type { ListingRef } from "@clearbolt/core";
import * as cheerio from "cheerio";
import {
  extractListingIdFromBizBuySellUrl,
  isBizBuySellBrokerProfileUrl,
  normalizeBizBuySellBrokerProfileUrl,
} from "../bizbuysell-broker-url.js";
import { listingRefFromBizBuySellUrl } from "../bizbuysell-listing-url.js";

export type BrokerProfileListingCard = {
  title?: string;
  url: string;
  externalId?: string;
  price?: string;
  location?: string;
  category?: string;
};

export type BrokerProfileExtract = {
  profileUrl: string;
  name?: string;
  firm?: string;
  phone?: string;
  email?: string;
  about?: string;
  tagline?: string;
  activeListings: BrokerProfileListingCard[];
  soldListings: BrokerProfileListingCard[];
  /** Union of listing ids seen on sold tab/cards. */
  soldListingIds: string[];
};

function extractJsonLdPerson(html: string): Partial<BrokerProfileExtract> {
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]!) as Record<string, unknown>;
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const type = node["@type"];
        const types = Array.isArray(type) ? type : type ? [type] : [];
        if (!types.includes("Person")) continue;
        const worksFor = node.worksFor as Record<string, unknown> | undefined;
        return {
          name: typeof node.name === "string" ? node.name : undefined,
          about:
            typeof node.description === "string"
              ? node.description
              : typeof worksFor?.description === "string"
                ? worksFor.description
                : undefined,
          firm:
            typeof worksFor?.name === "string" ? worksFor.name : undefined,
          profileUrl:
            typeof node.url === "string"
              ? normalizeBizBuySellBrokerProfileUrl(node.url) ?? undefined
              : undefined,
        };
      }
    } catch {
      /* skip */
    }
  }
  return {};
}

function cardFromAnchor(
  $: cheerio.CheerioAPI,
  el: Parameters<cheerio.CheerioAPI>[0],
): BrokerProfileListingCard | null {
  const a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
  const href = a.attr("href");
  if (!href) return null;
  const abs = new URL(href, "https://www.bizbuysell.com").toString();
  const externalId = extractListingIdFromBizBuySellUrl(abs);
  const title = a.text().trim() || $(el).find("h2,h3,h4,.title").first().text().trim();
  return {
    url: abs,
    externalId,
    title: title || undefined,
    price: $(el).find("[class*='price']").first().text().trim() || undefined,
    location:
      $(el).find("[class*='location']").first().text().trim() || undefined,
  };
}

function collectListingCards(
  $: cheerio.CheerioAPI,
  root: ReturnType<cheerio.CheerioAPI>,
): BrokerProfileListingCard[] {
  const cards: BrokerProfileListingCard[] = [];
  const seen = new Set<string>();
  root.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = new URL(href, "https://www.bizbuysell.com").toString();
    const id = extractListingIdFromBizBuySellUrl(abs);
    const isListing =
      listingRefFromBizBuySellUrl(abs) ||
      /sold-business\//i.test(abs) ||
      /Profile\/\?q=\d+/i.test(abs) ||
      Boolean(id);
    if (!isListing) return;
    const key = id ?? abs;
    if (seen.has(key)) return;
    seen.add(key);
    const card = cardFromAnchor($, el);
    if (card) cards.push(card);
  });
  return cards;
}

export function parseBizBuySellBrokerProfilePage(
  html: string,
  url: string,
): BrokerProfileExtract {
  const $ = cheerio.load(html);
  const profileUrl = normalizeBizBuySellBrokerProfileUrl(url) ?? url;
  const fromLd = extractJsonLdPerson(html);

  const extract: BrokerProfileExtract = {
    profileUrl,
    name: fromLd.name ?? ($("h1").first().text().trim() || undefined),
    firm: fromLd.firm,
    about: fromLd.about,
    tagline: $(".broker-tagline, .profile-tagline").first().text().trim() || undefined,
    activeListings: [],
    soldListings: [],
    soldListingIds: [],
  };

  const tel = $('a[href^="tel:"]').first().attr("href");
  if (tel) extract.phone = tel.replace(/^tel:/i, "").trim();

  const mail = $('a[href^="mailto:"]').first().attr("href");
  if (mail) extract.email = mail.replace(/^mailto:/i, "").split("?")[0]?.trim();

  const soldRoot = $(
    "#soldListings, [id*='sold'], [data-tab='sold'], .sold-listings, section.sold",
  ).first();
  const activeRoot = $(
    "#activeListings, [id*='for-sale'], [data-tab='for-sale'], .active-listings, section.for-sale",
  ).first();

  extract.soldListings = soldRoot.length
    ? collectListingCards($, soldRoot)
    : collectListingCards(
        $,
        $("a[href*='/sold-business/']").first().parent().parent(),
      );
  extract.activeListings = activeRoot.length
    ? collectListingCards($, activeRoot)
    : collectListingCards(
        $,
        $("a[href*='business-opportunity'], a[href*='business-for-sale']").first()
          .parent()
          .parent(),
      );

  if (extract.soldListings.length === 0) {
    $("a[href*='/sold-business/']").each((_, el) => {
      const card = cardFromAnchor($, el);
      if (card) extract.soldListings.push(card);
    });
  }

  const soldIds = new Set<string>();
  for (const card of extract.soldListings) {
    if (card.externalId) soldIds.add(card.externalId);
  }
  extract.soldListingIds = [...soldIds];

  return extract;
}

export function isListingSoldOnBrokerProfile(
  profile: BrokerProfileExtract,
  listingId: string,
): boolean {
  if (profile.soldListingIds.includes(listingId)) return true;
  return profile.soldListings.some((c) => c.externalId === listingId);
}

export function brokerProfileToRefs(
  cards: BrokerProfileListingCard[],
): ListingRef[] {
  const refs: ListingRef[] = [];
  for (const card of cards) {
    const ref = listingRefFromBizBuySellUrl(card.url);
    if (ref) refs.push(ref);
    else if (card.externalId) {
      refs.push({ url: card.url, externalId: card.externalId });
    }
  }
  return refs;
}

export function assertBrokerProfileUrl(url: string): void {
  if (!isBizBuySellBrokerProfileUrl(url)) {
    throw new Error(`Not a BizBuySell broker profile URL: ${url}`);
  }
}
