import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import {
  extractBusinessBrokerListingIdFromPathname,
  isBusinessBrokerListingUrl,
} from "../businessbroker-listing-url.js";

export type BusinessBrokerListingExtract = {
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

function parseLocationParts(
  locations: string[],
): Pick<BusinessBrokerListingExtract, "city" | "state" | "location"> {
  const cleaned = locations.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (cleaned.length === 0) return {};
  const primary = cleaned[0]!;
  const comma = primary.match(/^(.+?),\s*([A-Z]{2})$/);
  if (comma) {
    return {
      city: comma[1]!.trim(),
      state: comma[2]!.trim(),
      location: cleaned.join("; "),
    };
  }
  if (/^[A-Z]{2}$/.test(primary)) {
    return { state: primary, location: cleaned.join("; ") };
  }
  return { location: cleaned.join("; ") };
}

const QUICK_FACT_LABELS =
  "Asking Price|Annual Revenue|Net Profit|Cash Flow|Total Debt|FF&E|Real Estate|Year Established|Employees|BBN Listing #";

function readLabeledValue(text: string, label: string): string | undefined {
  const re = new RegExp(
    `${label}\\s*:\\s*(.+?)(?=\\s+(?:${QUICK_FACT_LABELS})\\s*:|$)`,
    "i",
  );
  const m = text.match(re);
  const val = m?.[1]?.trim();
  if (!val || /^not disclosed$/i.test(val)) return undefined;
  return val;
}

function readLabeledMoney(text: string, label: string): number | undefined {
  const raw = readLabeledValue(text, label);
  return parseMoney(raw);
}

function extractQuickFacts(
  $: CheerioAPI,
  into: BusinessBrokerListingExtract,
): void {
  const block =
    $(".busListingQuickFacts").text() ||
    $(".pbd_left").text() ||
    "";
  const text = block.replace(/\s+/g, " ").trim();
  if (!text) return;

  into.askingPrice =
    readLabeledMoney(text, "Asking Price") ?? into.askingPrice;
  into.revenue = readLabeledMoney(text, "Annual Revenue") ?? into.revenue;
  into.cashFlow = readLabeledMoney(text, "Cash Flow") ?? into.cashFlow;

  const listingNum = readLabeledValue(text, "BBN Listing #");
  const listingDigits = listingNum?.match(/(\d{4,})/)?.[1];
  if (listingDigits) {
    into.listingId = listingDigits;
    into.externalId = listingDigits;
  }
}

function extractBroker($: CheerioAPI, into: BusinessBrokerListingExtract): void {
  $(".contact_seller_content li").each((_, el) => {
    const line = $(el).text().replace(/\s+/g, " ").trim();
    const contact = line.match(/^Contact:\s*(.+)$/i);
    if (contact?.[1]) {
      into.brokerName = contact[1].trim();
    }
  });
}

function extractIndustry($: CheerioAPI, into: BusinessBrokerListingExtract): void {
  const crumbs = $("#breadcrumbs a, ol#breadcrumbs a")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t && !/^home$/i.test(t));
  const industry = crumbs.find((t) => /businesses for sale|business for sale/i.test(t));
  if (industry) into.industry = industry;
}

export function parseBusinessBrokerListingPage(
  html: string,
  url: string,
): BusinessBrokerListingExtract {
  const $ = cheerio.load(html);
  const pathname = new URL(url).pathname;
  const fromPath = extractBusinessBrokerListingIdFromPathname(pathname);

  const extract: BusinessBrokerListingExtract = {
    externalId: fromPath,
    listingId: fromPath,
  };

  const title = $("h1").first().text().trim();
  if (title) extract.title = title;

  const locations = $(".location")
    .map((_, el) => $(el).text().trim())
    .get();
  if (locations.length > 0) {
    Object.assign(extract, parseLocationParts(locations));
  } else {
    const og = $("meta[property='og:description']").attr("content")?.trim();
    const dashLoc = og?.match(/-\s*([^,-]+),\s*([A-Za-z]{2,})\s*-/);
    const inLoc = og?.match(/\bin\s+([^,-]+),\s*([A-Za-z]{2,})\b/i);
    const m = dashLoc ?? inLoc;
    if (m) {
      const statePart = m[2]!.trim();
      const state =
        statePart.length === 2
          ? statePart.toUpperCase()
          : statePart.slice(0, 2).toUpperCase();
      Object.assign(
        extract,
        parseLocationParts([`${m[1]!.trim()}, ${state}`]),
      );
    }
  }

  const description = $(".busListingContent")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (description) extract.description = description.slice(0, 50_000);

  extractQuickFacts($, extract);
  extractBroker($, extract);
  extractIndustry($, extract);

  if (!extract.askingPrice) {
    const priceSpan = $(".result-img span, .listing-text span")
      .filter((_, el) => /asking price/i.test($(el).text()))
      .first()
      .text();
    extract.askingPrice = parseMoney(priceSpan);
  }

  return extract;
}

export function toParsedListingFields(
  extract: BusinessBrokerListingExtract,
): import("@clearbolt/core").ParsedListingFields & {
  externalId?: string;
} {
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

export function assertBusinessBrokerListingUrl(url: string): void {
  if (!isBusinessBrokerListingUrl(url)) {
    throw new Error(`not a BusinessBroker.net listing URL: ${url}`);
  }
}
