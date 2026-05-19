import * as cheerio from "cheerio";
import {
  extractBizQuestListingIdFromPathname,
  isBizQuestListingUrl,
} from "../bizquest-listing-url.js";

export type BizQuestListingExtract = {
  title?: string;
  askingPrice?: number;
  revenue?: number;
  cashFlow?: number;
  city?: string;
  state?: string;
  location?: string;
  industry?: string;
  brokerName?: string;
  description?: string;
  externalId?: string;
  listingId?: string;
};

function parseMoney(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^0-9.]/g, "");
  if (!digits) return undefined;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function parseLocationText(text: string | undefined): {
  city?: string;
  state?: string;
  location?: string;
} {
  if (!text?.trim()) return {};
  const cleaned = text.replace(/\s+/g, " ").trim();
  const comma = cleaned.match(/^(.+?),\s*([A-Z]{2})$/);
  if (comma) {
    return {
      city: comma[1]?.trim(),
      state: comma[2]?.trim(),
      location: cleaned,
    };
  }
  if (/^[A-Z]{2}$/.test(cleaned)) return { state: cleaned, location: cleaned };
  return { location: cleaned };
}

function readJsonLdOffers($: cheerio.CheerioAPI): {
  price?: number;
  title?: string;
} {
  let price: number | undefined;
  let title: string | undefined;
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const o = node as Record<string, unknown>;
        if (typeof o.name === "string" && !title) title = o.name.trim();
        const offers = o.offers;
        const offerList = Array.isArray(offers)
          ? offers
          : offers
            ? [offers]
            : [];
        for (const offer of offerList) {
          if (!offer || typeof offer !== "object") continue;
          const priceVal = (offer as { price?: unknown }).price;
          if (typeof priceVal === "number" && !price) price = priceVal;
          if (typeof priceVal === "string" && !price) {
            price = parseMoney(priceVal);
          }
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return { price, title };
}

export function parseBizQuestListingPage(
  html: string,
  url: string,
): BizQuestListingExtract {
  const $ = cheerio.load(html);
  const u = new URL(url);
  const externalId =
    extractBizQuestListingIdFromPathname(u.pathname) ??
    $("[data-listing-id]").first().attr("data-listing-id")?.trim();

  const jsonLd = readJsonLdOffers($);
  const title =
    $("h1").first().text().trim() ||
    jsonLd.title ||
    $("meta[property='og:title']").attr("content")?.trim();

  let askingPrice =
    parseMoney($("[data-testid='asking-price']").first().text()) ??
    parseMoney($(".listing-price, .price, .asking-price").first().text());
  if (askingPrice === undefined) {
    const priceMatch = html.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    askingPrice = parseMoney(priceMatch?.[0]);
  }
  if (askingPrice === undefined) askingPrice = jsonLd.price;

  const locationText =
    $(".location, [data-testid='location'], .listing-location")
      .first()
      .text()
      .trim() || undefined;
  const loc = parseLocationText(locationText);

  const description =
    $(".listing-description, .description, #description")
      .first()
      .text()
      .trim() || undefined;

  const industry =
    $(".industry, [data-testid='industry'], .breadcrumb-industry")
      .first()
      .text()
      .trim() || undefined;

  const brokerName =
    $(".broker-name, [data-testid='broker-name'], .listing-broker")
      .first()
      .text()
      .trim() || undefined;

  const cashFlowMatch = html.match(
    /cash\s*flow[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  );
  const revenueMatch = html.match(/revenue[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i);

  return {
    title: title || undefined,
    askingPrice,
    revenue: parseMoney(revenueMatch?.[0]),
    cashFlow: parseMoney(cashFlowMatch?.[0]),
    ...loc,
    industry: industry || undefined,
    brokerName: brokerName || undefined,
    description: description || undefined,
    externalId,
    listingId: externalId,
  };
}

export function assertBizQuestListingUrl(url: string): void {
  if (!isBizQuestListingUrl(url)) {
    throw new Error(`not a BizQuest listing URL: ${url}`);
  }
}
