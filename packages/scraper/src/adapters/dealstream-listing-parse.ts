import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { normalizeDealStreamBrokerProfileUrl } from "../dealstream-broker-url.js";
import {
  extractDealStreamListingIdFromPathname,
  isDealStreamListingUrl,
} from "../dealstream-listing-url.js";

export type DealStreamListingExtract = {
  title?: string;
  askingPrice?: number;
  revenue?: number;
  cashFlow?: number;
  city?: string;
  state?: string;
  location?: string;
  industry?: string;
  brokerName?: string;
  brokerProfileUrl?: string;
  description?: string;
  externalId?: string;
  listingId?: string;
  status?: string;
  representedByBroker?: boolean;
  sourceQualityHint?: "high" | "medium" | "low";
};

function parseMoney(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  if (/on request|not disclosed|n\/a/i.test(raw)) return undefined;
  const digits = raw.replace(/[^0-9.]/g, "");
  if (!digits) return undefined;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function labelValue(text: string, label: string): string | undefined {
  const re = new RegExp(`${label}\\s*\\n?\\s*([^\\n$]+)`, "i");
  const m = text.match(re);
  const val = m?.[1]?.trim();
  return val && val.length > 0 ? val : undefined;
}

function parseLocationLine(
  line: string | undefined,
): Pick<DealStreamListingExtract, "city" | "state" | "location"> {
  if (!line) return {};
  const cleaned = line.replace(/\s+/g, " ").trim();
  if (!cleaned) return {};
  const comma = cleaned.match(/^(.+?),\s*([A-Z]{2})$/);
  if (comma) {
    return {
      city: comma[1]?.trim(),
      state: comma[2]?.trim(),
      location: cleaned,
    };
  }
  if (/^[A-Z]{2}$/.test(cleaned)) {
    return { state: cleaned, location: cleaned };
  }
  return { location: cleaned };
}

function extractFinancials(
  $: CheerioAPI,
  into: DealStreamListingExtract,
): void {
  const bodyText = $("body").text().replace(/\s+/g, " ");
  into.askingPrice =
    parseMoney(labelValue(bodyText, "Asking Price")) ?? into.askingPrice;
  into.cashFlow =
    parseMoney(labelValue(bodyText, "Cash Flow")) ?? into.cashFlow;
  into.revenue = parseMoney(labelValue(bodyText, "Sales")) ?? into.revenue;

  $("h2, h3, dt, th, strong, label, div, span").each((_, el) => {
    const label = $(el).text().trim();
    const next = $(el).next().text().trim();
    if (/^asking price$/i.test(label)) {
      into.askingPrice = parseMoney(next) ?? into.askingPrice;
    }
    if (/^cash flow$/i.test(label)) {
      into.cashFlow = parseMoney(next) ?? into.cashFlow;
    }
    if (/^sales$/i.test(label)) {
      into.revenue = parseMoney(next) ?? into.revenue;
    }
  });
}

function extractBroker(
  $: CheerioAPI,
  base: URL,
  into: DealStreamListingExtract,
): void {
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const abs = new URL(href, base).toString();
      const profile = normalizeDealStreamBrokerProfileUrl(abs);
      if (profile) {
        into.brokerProfileUrl = profile;
        const name = $(el).text().replace(/\s+/g, " ").trim();
        if (name && name.length < 120) into.brokerName = name;
        return false;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  });
}

function extractIndustry($: CheerioAPI, into: DealStreamListingExtract): void {
  const crumbs = $("a[href*='-businesses-for-sale'], nav a")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const industry = crumbs.find((t) => /businesses for sale/i.test(t));
  if (industry) into.industry = industry.replace(/\s+for sale$/i, "").trim();
}

export function parseDealStreamListingPage(
  html: string,
  url: string,
): DealStreamListingExtract {
  const $ = cheerio.load(html);
  const base = new URL(url);
  const fromPath = extractDealStreamListingIdFromPathname(base.pathname);

  const extract: DealStreamListingExtract = {
    externalId: fromPath,
    listingId: fromPath,
    sourceQualityHint: "medium",
  };

  const title = $("h1").first().text().trim();
  if (title) extract.title = title;

  if (/no longer available|listing is no longer/i.test($("body").text())) {
    extract.status = "Unavailable";
  }

  const locationLine = $("body")
    .text()
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /,\s*[A-Z]{2}$/.test(l) || /^[A-Z]{2}$/.test(l));
  Object.assign(extract, parseLocationLine(locationLine));

  const description = $("section, article, .listing, main")
    .filter((_, el) => /business for sale details/i.test($(el).text()))
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (description) {
    extract.description = description.slice(0, 50_000);
  } else {
    const fallback = $("main, article")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (fallback) extract.description = fallback.slice(0, 50_000);
  }

  extractFinancials($, extract);
  extractBroker($, base, extract);
  extractIndustry($, extract);

  const bodyText = $("body").text();
  if (/represented by broker\?\s*yes/i.test(bodyText)) {
    extract.representedByBroker = true;
  }

  const listingNum = bodyText.match(/LISTING ID\s*#\s*(\d+)/i);
  if (listingNum?.[1]) {
    extract.listingId = listingNum[1];
  }

  return extract;
}

export function toParsedListingFields(
  extract: DealStreamListingExtract,
): import("@clearbolt/core").ParsedListingFields & { externalId?: string } {
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
    brokerProfileUrl: extract.brokerProfileUrl,
    description: extract.description,
    status: extract.status,
    externalId: extract.externalId,
    listingId: extract.listingId ?? extract.externalId,
  };
}

export function assertDealStreamListingUrl(url: string): void {
  if (!isDealStreamListingUrl(url)) {
    throw new Error(`not a DealStream listing URL: ${url}`);
  }
}
