import * as cheerio from "cheerio";
import { z } from "zod";

export const BROKER_SITE_LISTING_PARSER_VERSION = "broker-site-v0-heuristic";

export const BrokerSiteListingExtractSchema = z.object({
  title: z.string().optional(),
  askingPrice: z.number().optional(),
  revenue: z.number().optional(),
  cashFlow: z.number().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  location: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  brokerName: z.string().optional(),
});

export type BrokerSiteListingExtract = z.infer<typeof BrokerSiteListingExtractSchema>;

function parseMoney(text: string): number | undefined {
  const m = text.replace(/,/g, "").match(/\$?\s*([\d.]+)\s*([mk])?/i);
  if (!m?.[1]) return undefined;
  let n = Number.parseFloat(m[1]);
  if (Number.isNaN(n)) return undefined;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "m") n *= 1_000_000;
  if (suffix === "k") n *= 1_000;
  return Math.round(n);
}

function parseStateLocation(text: string): {
  state?: string;
  city?: string;
  location?: string;
} {
  const t = text.trim();
  if (!t) return {};
  const us = t.match(/([A-Za-z .'-]+),\s*([A-Z]{2})\b/);
  if (us) {
    return { city: us[1]?.trim(), state: us[2], location: t };
  }
  if (/^[A-Z]{2}$/.test(t)) return { state: t, location: t };
  return { location: t };
}

export function parseBrokerSiteListingPage(
  html: string,
  _url: string,
): BrokerSiteListingExtract {
  const $ = cheerio.load(html);
  const extract: BrokerSiteListingExtract = {};

  extract.title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().trim().split("|")[0]?.trim();

  const bodyText = $("body").text().replace(/\s+/g, " ");
  const priceMatch = bodyText.match(
    /(?:asking|price|list(?:ed)?)\s*(?:price)?[:\s]*\$[\d,]+(?:\.\d{2})?/i,
  );
  if (priceMatch) extract.askingPrice = parseMoney(priceMatch[0]);
  if (!extract.askingPrice) {
    const anyPrice = bodyText.match(/\$[\d,]+(?:\.\d{2})?/);
    if (anyPrice) extract.askingPrice = parseMoney(anyPrice[0]);
  }

  const rev = bodyText.match(/(?:gross\s+)?revenue[:\s]*\$[\d,]+/i);
  if (rev) extract.revenue = parseMoney(rev[0]);
  const cf = bodyText.match(/(?:cash\s+flow|sde|ebitda)[:\s]*\$[\d,]+/i);
  if (cf) extract.cashFlow = parseMoney(cf[0]);

  const loc =
    $("[class*='location'], .location, [itemprop='address']").first().text().trim() ||
    bodyText.match(/location[:\s]*([A-Za-z0-9 ,.-]{3,60})/i)?.[1];
  if (loc) Object.assign(extract, parseStateLocation(loc));

  extract.industry =
    $("[class*='industry'], .industry, [itemprop='industry']").first().text().trim() ||
    undefined;

  const desc =
    $("article p, .description, [class*='description'], [itemprop='description']")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
  if (desc.length > 40) extract.description = desc.slice(0, 4000);

  extract.brokerName =
    $("[class*='broker'], .broker-name").first().text().trim() || undefined;

  return extract;
}

export function toParsedListingFields(
  extract: BrokerSiteListingExtract,
  sourceUrl: string,
): Record<string, unknown> {
  return {
    ...extract,
    linkToDeal: sourceUrl,
  };
}
