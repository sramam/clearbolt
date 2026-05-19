import type { ParsedListingFields } from "@clearbolt/core";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { normalizeBizBuySellBrokerProfileUrl } from "../bizbuysell-broker-url.js";
import { extractBizBuySellListingIdFromPathname } from "../bizbuysell-listing-url.js";
import {
  type ListingGeoEncoding,
  encodeListingGeo,
} from "../listing-geo-h3.js";

export const BIZBUYSELL_LISTING_PARSER_VERSION = "clearbolt-listing-v1";

/** Rich BizBuySell listing extract (Apify-aligned field names + geo/H3). */
export type BizBuySellListingExtract = ParsedListingFields & {
  externalId?: string;
  dateAdded?: string;
  linkToDeal?: string;
  location?: string;
  stateName?: string;
  yearEstablished?: number;
  status?: string;
  category?: string;
  categories?: string[];
  finalCategory?: string;
  ebitda?: number;
  industryDetails?: string;
  numberOfEmployees?: string;
  inventory?: string;
  inventoryValue?: number;
  inventoryIncludedInAskingPrice?: boolean;
  ffeIncludedInAskingPrice?: boolean;
  rent?: string;
  rentAmount?: number;
  reasonForSelling?: string;
  sellerType?: string;
  realEstate?: string;
  buildingSf?: string;
  facilities?: string;
  ffe?: string;
  intermediaryName?: string;
  intermediaryFirm?: string;
  intermediaryPhone?: string;
  intermediaryEmail?: string;
  brokerProfileUrl?: string;
  brokerageNote?: string;
  agentUrl?: string;
  agentWebsite?: string;
  /** Why status was set (e.g. broker-profile sold tab). */
  soldSource?: string;
  /** Enrich-phase sources applied (e.g. broker-profile, llm-openrouter). */
  enrichSources?: string[];
  growthAndExpansion?: string;
  financing?: string;
  supportAndTraining?: string;
  franchise?: string;
  competition?: string;
  homeBased?: string;
  tagline?: string;
  imageUrls?: string[];
  geo?: ListingGeoEncoding;
  /** Unmapped detail labels from the page (for parser drift debugging). */
  extraDetails?: Record<string, string>;
};

function parseMoney(raw: string): number | undefined {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || /not disclosed|n\/a|—|-/i.test(t)) return undefined;
  const m = t.match(/\$?([\d,]+(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1]?.replace(/,/g, ""));
  return Number.isNaN(n) ? undefined : n;
}

function parseYear(raw: string): number | undefined {
  const m = raw.trim().match(/\b(19|20)\d{2}\b/);
  if (!m) return undefined;
  const y = Number.parseInt(m[0], 10);
  return Number.isNaN(y) ? undefined : y;
}

function cleanDetailValue(el: ReturnType<CheerioAPI>): string {
  const clone = el.clone();
  clone.find("i.help, .help").remove();
  return clone.text().replace(/\s+/g, " ").trim();
}

/** Preserve line breaks from `<br>` / block children in detail `<dd>` cells. */
function detailDdLines($: CheerioAPI, dd: ReturnType<CheerioAPI>): string[] {
  const clone = dd.clone();
  clone.find("i.help, .help").remove();
  clone.find("br").replaceWith("\n");
  clone.find("p").each((_, p) => {
    $(p).replaceWith(`${$(p).text()}\n`);
  });
  return clone
    .text()
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function applyInventoryDetail(
  into: BizBuySellListingExtract,
  lines: string[],
): void {
  const raw = lines.join(" | ");
  into.inventory = raw;
  into.inventoryValue = parseMoney(raw);
  into.inventoryIncludedInAskingPrice = lines.some((l) =>
    /included in asking price/i.test(l),
  )
    ? true
    : undefined;
}

function applyRentDetail(
  into: BizBuySellListingExtract,
  lines: string[],
): void {
  const raw = lines.join(" | ");
  into.rent = raw;
  into.rentAmount = parseMoney(raw);
}

function applyFfeDetail(into: BizBuySellListingExtract, lines: string[]): void {
  const raw = lines.join(" | ");
  into.ffe = raw;
  into.ffeIncludedInAskingPrice = lines.some((l) =>
    /included in asking price/i.test(l),
  )
    ? true
    : undefined;
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    try {
      const jsonRaw = m[1];
      if (jsonRaw !== undefined) blocks.push(JSON.parse(jsonRaw));
    } catch {
      /* skip */
    }
    m = re.exec(html);
  }
  return blocks;
}

function walkJsonLd(
  node: unknown,
  visit: (obj: Record<string, unknown>) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, visit);
    return;
  }
  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const v of Object.values(obj)) walkJsonLd(v, visit);
}

function parseJsonLd(
  blocks: unknown[],
  url: string,
): Partial<BizBuySellListingExtract> {
  const out: Partial<BizBuySellListingExtract> = {};
  let productDescription: string | undefined;
  let localCity: string | undefined;
  let localRegion: string | undefined;
  const breadcrumbs: string[] = [];

  for (const block of blocks) {
    walkJsonLd(block, (obj) => {
      const type = obj["@type"];
      const types = Array.isArray(type) ? type : type ? [type] : [];
      if (types.includes("Product")) {
        if (typeof obj.name === "string" && !out.title) {
          out.title = obj.name.split(" - BizBuySell")[0]?.trim() || obj.name;
        }
        if (typeof obj.category === "string") out.category = obj.category;
        if (typeof obj.description === "string") {
          productDescription = obj.description;
        }
        if (typeof obj.productid === "string") {
          out.listingId = obj.productid;
          out.externalId = obj.productid;
        }
        if (typeof obj.image === "string") {
          out.imageUrls = [...(out.imageUrls ?? []), obj.image];
        }
        if (typeof obj.alternateName === "string") {
          out.tagline = obj.alternateName;
        }
      }
      if (types.includes("LocalBusiness")) {
        const addr = obj.address as Record<string, string> | undefined;
        if (addr) {
          localCity = addr.addressLocality ?? localCity;
          localRegion = addr.addressRegion ?? localRegion;
        }
        if (typeof obj.description === "string" && !out.industryDetails) {
          out.industryDetails = obj.description.slice(0, 50_000);
        }
      }
      if (types.includes("BreadcrumbList")) {
        const items = obj.itemListElement;
        if (Array.isArray(items)) {
          for (const item of items) {
            const name = (item as Record<string, unknown>)?.item as
              | Record<string, string>
              | undefined;
            const label =
              typeof name?.name === "string"
                ? name.name
                : typeof (item as Record<string, unknown>).name === "string"
                  ? ((item as Record<string, unknown>).name as string)
                  : undefined;
            if (
              label &&
              label !== "BizBuySell" &&
              !label.includes("Business For Sale")
            ) {
              breadcrumbs.push(label);
            }
          }
        }
      }
    });
  }

  if (breadcrumbs.length > 0) {
    const cats = breadcrumbs.filter(
      (b) => !/businesses for sale/i.test(b) && b.length < 80,
    );
    if (cats.length > 0) {
      out.categories = cats;
      out.finalCategory = cats[cats.length - 1];
      out.category = out.category ?? cats.join(" > ");
    }
  }

  if (localCity) out.city = localCity;
  if (localRegion) {
    out.stateName = localRegion;
    out.state =
      localRegion.length === 2
        ? localRegion.toUpperCase()
        : (stateAbbrev(localRegion) ?? localRegion);
  }
  if (localCity && out.state) {
    out.location = `${localCity}, ${out.state}`;
  }
  if (productDescription && !out.industryDetails) {
    out.industryDetails = productDescription.slice(0, 50_000);
  }
  out.linkToDeal = url;
  return out;
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

function stateAbbrev(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  if (key.length === 2) return key.toUpperCase();
  return STATE_NAME_TO_CODE[key];
}

const FINANCIAL_LABEL_MAP: Record<string, keyof BizBuySellListingExtract> = {
  "asking price": "askingPrice",
  price: "askingPrice",
  "gross revenue": "revenue",
  revenue: "revenue",
  "cash flow (sde)": "cashFlow",
  "cash flow": "cashFlow",
  ebitda: "ebitda",
  established: "yearEstablished",
};

const DETAIL_LABEL_MAP: Record<string, keyof BizBuySellListingExtract> = {
  location: "location",
  facilities: "facilities",
  competition: "competition",
  "growth & expansion": "growthAndExpansion",
  financing: "financing",
  "support & training": "supportAndTraining",
  "home-based": "homeBased",
  franchise: "franchise",
  "real estate": "realEstate",
  "building sf": "buildingSf",
  "building square feet": "buildingSf",
  inventory: "inventory",
  "reason for selling": "reasonForSelling",
  "seller type": "sellerType",
  "number of employees": "numberOfEmployees",
  employees: "numberOfEmployees",
  rent: "rent",
  "furniture, fixtures, & equipment (ff&e)": "ffe",
  "ff&e": "ffe",
  industry: "industry",
};

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, " ").replace(/:$/, "").trim().toLowerCase();
}

function extractListingRows(
  $: CheerioAPI,
  into: BizBuySellListingExtract,
): void {
  $("p.m-listing-row, p.dt-grid-2.m-listing-row").each((_, row) => {
    const label = normalizeLabel($(row).find("span.title").first().text());
    const valueEl = $(row).find("span.normal, span.price").first();
    const value = cleanDetailValue(valueEl.length ? valueEl : $(row));
    if (!label || !value) return;

    const finKey = FINANCIAL_LABEL_MAP[label];
    if (finKey === "askingPrice") into.askingPrice = parseMoney(value);
    else if (finKey === "revenue") into.revenue = parseMoney(value);
    else if (finKey === "cashFlow") into.cashFlow = parseMoney(value);
    else if (finKey === "ebitda") into.ebitda = parseMoney(value);
    else if (finKey === "yearEstablished")
      into.yearEstablished = parseYear(value);
  });
}

function applyDetailField(
  into: BizBuySellListingExtract,
  label: string,
  lines: string[],
): void {
  const value = lines.join(" | ");
  if (!value) return;

  if (label === "inventory") {
    applyInventoryDetail(into, lines);
    return;
  }
  if (label === "rent") {
    applyRentDetail(into, lines);
    return;
  }
  if (label === "furniture, fixtures, & equipment (ff&e)" || label === "ff&e") {
    applyFfeDetail(into, lines);
    return;
  }

  const mapped = DETAIL_LABEL_MAP[label];
  if (mapped) {
    if (mapped === "yearEstablished") {
      into.yearEstablished = parseYear(value);
    } else if (mapped === "location") {
      into.location = value;
      const parsed = value.match(/^(.+),\s*([A-Z]{2})$/);
      if (parsed) {
        into.city = parsed[1]?.trim();
        into.state = parsed[2];
      }
    } else if (mapped === "numberOfEmployees") {
      into.numberOfEmployees = value;
    } else {
      (into as Record<string, unknown>)[mapped] = value;
    }
    return;
  }

  into.extraDetails = into.extraDetails ?? {};
  into.extraDetails[label] = value;
}

function extractDetailDl(
  $: CheerioAPI,
  dlId: string,
  into: BizBuySellListingExtract,
): void {
  $(`#${dlId} dt`).each((_, dt) => {
    const label = normalizeLabel(
      $(dt).find("span.normal").text() || $(dt).text(),
    );
    const dd = $(dt).next("dd");
    const lines = detailDdLines($, dd);
    if (!label || lines.length === 0) return;
    applyDetailField(into, label, lines);
  });
}

function extractAllProfileDetailDls(
  $: CheerioAPI,
  into: BizBuySellListingExtract,
): void {
  $("dl.listingProfile_details").each((_, dl) => {
    const id = $(dl).attr("id");
    if (id === "dlDetailedInformation" || id === "dlLocationInformation")
      return;
    $(dl)
      .find("dt")
      .each((_, dt) => {
        const label = normalizeLabel(
          $(dt).find("span.normal").text() || $(dt).text(),
        );
        const lines = detailDdLines($, $(dt).next("dd"));
        if (!label || lines.length === 0) return;
        applyDetailField(into, label, lines);
      });
  });
}

function normalizeTelHref(href: string): string {
  return href.replace(/^tel:/i, "").trim();
}

function isPlausibleBrokerPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 11;
}

/**
 * BizBuySell "click to see phone" only toggles CSS on a pre-rendered `tel:` link
 * inside `.lblViewTpnTelephone_{listingId}` (not an XHR). Search globally so we
 * still capture it when the broker card sits outside `#contactForm`.
 */
export function extractBrokerPhoneFromListingHtml(
  $: CheerioAPI,
  listingId?: string,
): string | undefined {
  const selectors = [
    listingId ? `#lblViewTpnTelephone_${listingId} a[href^="tel:"]` : null,
    '[class*="lblViewTpnTelephone"] a[href^="tel:"]',
    ".contact-phone-selector a[href^='tel:']",
    ".broker-card a[href^='tel:']",
    ".broker a[href^='tel:']",
  ].filter((s): s is string => s != null);

  for (const selector of selectors) {
    const href = $(selector).first().attr("href");
    if (!href) continue;
    const phone = normalizeTelHref(href);
    if (isPlausibleBrokerPhone(phone)) return phone;
  }
  return undefined;
}

function cleanBrokerName(raw: string): string | undefined {
  let name = raw;
  const scriptCut = name.search(
    /\$\(function|<script|executeBefore|TrackListingAction/i,
  );
  if (scriptCut >= 0) name = name.slice(0, scriptCut);
  name = name
    .replace(/business\s+listed\s+by:?/gi, "")
    .replace(/listed by:?/gi, "")
    .replace(/phone number/gi, "")
    .replace(/^business\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return undefined;
  if (/contact form|enter a valid full name/i.test(name)) return undefined;
  return name;
}

function extractBroker($: CheerioAPI, into: BizBuySellListingExtract): void {
  const brokerRoots = $(".broker");
  const cardScope = brokerRoots.find(".broker-card").first();
  const scope = cardScope.length
    ? cardScope
    : brokerRoots.first().length
      ? brokerRoots.first()
      : $("#contactForm, #contactSellerForm").first();

  const listedBy = scope
    .find("span")
    .filter((_, el) => /listed by/i.test($(el).text()))
    .first();
  let name = "";
  if (listedBy.length) {
    const block = listedBy.parent().text();
    name = cleanBrokerName(block) ?? "";
  } else if (scope.length) {
    name = cleanBrokerName(scope.text()) ?? "";
  }
  if (name) {
    into.intermediaryName = name;
    into.brokerName = name.split(/\n/)[0]?.trim() || name;
  }

  const scopeTel = scope.find('a[href^="tel:"]').first().attr("href");
  const phone =
    extractBrokerPhoneFromListingHtml($, into.listingId ?? into.externalId) ??
    (scopeTel ? normalizeTelHref(scopeTel) : undefined);
  if (phone && isPlausibleBrokerPhone(phone)) {
    into.intermediaryPhone = phone;
  }

  const mail = scope.find('a[href^="mailto:"]').first().attr("href");
  if (mail) {
    into.intermediaryEmail = mail
      .replace(/^mailto:/i, "")
      .split("?")[0]
      ?.trim();
  }

  const profileLink = brokerRoots
    .find('a[href*="/business-broker/"]')
    .add($('a[href*="/business-broker/"]'))
    .first();
  if (profileLink.length) {
    const href = profileLink.attr("href");
    if (href) {
      const abs = new URL(href, "https://www.bizbuysell.com").toString();
      into.brokerProfileUrl = normalizeBizBuySellBrokerProfileUrl(abs) ?? abs;
      into.agentUrl = into.brokerProfileUrl;
    }
    const linkText = profileLink.text().trim();
    if (linkText && !/view profile|broker profile/i.test(linkText)) {
      into.intermediaryFirm = linkText;
    }
  }

  const firmLink = scope
    .find('a[href*="/business-brokers/"]')
    .not('[href$="/directory/"]')
    .first();
  if (firmLink.length && !into.intermediaryFirm) {
    const firmText = firmLink.text().trim();
    if (firmText) into.intermediaryFirm = firmText;
  }

  const note = scope
    .find(".broker-about, .broker-description, .broker-note")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (note) into.brokerageNote = note.slice(0, 8000);
}

function extractImages($: CheerioAPI, into: BizBuySellListingExtract): void {
  const urls = new Set<string>();
  $("#slider img.image, .listing-img img, img.mainPhoto-print").each(
    (_, img) => {
      const src = $(img).attr("src");
      if (src?.includes("images.bizbuysell.com")) urls.add(src);
    },
  );
  if (urls.size > 0) {
    into.imageUrls = [...urls];
  }
}

function extractStatus($: CheerioAPI): string | undefined {
  const badge = $(".listing-status, .status-badge, [class*='sale-pending']")
    .first()
    .text()
    .trim();
  if (/sale pending/i.test(badge)) return "Sale Pending";
  if (/sold/i.test(badge)) return "Sold";
  if (/active/i.test(badge)) return "Active";
  return undefined;
}

export function parseBizBuySellListingPage(
  html: string,
  url: string,
  options?: { scrapedAt?: string },
): BizBuySellListingExtract {
  const $ = cheerio.load(html);
  const scrapedAt = options?.scrapedAt ?? new Date().toISOString();
  const listingId = extractBizBuySellListingIdFromPathname(
    new URL(url).pathname,
  );

  const fromLd = parseJsonLd(extractJsonLdBlocks(html), url);

  const extract: BizBuySellListingExtract = {
    ...fromLd,
    dateAdded: scrapedAt,
    linkToDeal: url,
    listingId: listingId ?? fromLd.listingId,
    externalId: listingId ?? fromLd.externalId,
  };

  const h1 = $("h1").first().text().trim();
  if (h1) extract.title = h1;

  if (!extract.title) {
    const hidden = $("span.h3.hidden").first().text().trim();
    if (hidden) extract.title = hidden;
  }
  if (!extract.title) {
    const t = $("title").text().trim().split("|")[0]?.trim();
    if (t) extract.title = t;
  }

  const tagline = $("span.profileAdLine").first().text().trim();
  if (tagline) extract.tagline = extract.tagline ?? tagline;

  const desc = $(".businessDescription")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (desc) {
    extract.industryDetails = extract.industryDetails ?? desc.slice(0, 50_000);
  }

  extractListingRows($, extract);
  if (extract.askingPrice == null) {
    const legacyPrice = $(
      ".asking-price, .business-price, [class*='asking-price']",
    )
      .first()
      .text();
    extract.askingPrice = parseMoney(legacyPrice);
  }
  extractDetailDl($, "dlDetailedInformation", extract);
  extractDetailDl($, "dlLocationInformation", extract);
  extractAllProfileDetailDls($, extract);
  extractBroker($, extract);
  extractImages($, extract);
  extract.status = extractStatus($) ?? extract.status;

  if (extract.location && !extract.city) {
    const m = extract.location.match(/^(.+),\s*([A-Z]{2})$/);
    if (m) {
      extract.city = m[1]?.trim();
      extract.state = m[2];
    }
  }

  if (extract.finalCategory && !extract.industry) {
    extract.industry = extract.finalCategory;
  }
  if (extract.category && !extract.industry) {
    extract.industry = extract.finalCategory ?? extract.category;
  }

  extract.geo = encodeListingGeo({
    location: extract.location,
    city: extract.city,
    state: extract.state,
    stateName: extract.stateName,
  });

  return extract;
}

export function toParsedListingFields(
  extract: BizBuySellListingExtract,
): ParsedListingFields & { externalId?: string } {
  return {
    title: extract.title,
    askingPrice: extract.askingPrice,
    revenue: extract.revenue,
    cashFlow: extract.cashFlow,
    ebitda: extract.ebitda,
    city: extract.city,
    state: extract.state,
    industry: extract.industry,
    brokerName: extract.brokerName ?? extract.intermediaryName,
    brokerProfileUrl: extract.brokerProfileUrl ?? extract.agentUrl,
    listingId: extract.listingId,
    externalId: extract.externalId,
    location: extract.location,
    stateName: extract.stateName,
    yearEstablished: extract.yearEstablished,
    status: extract.status,
    category: extract.category,
    categories: extract.categories,
    description: extract.industryDetails?.slice(0, 4000),
  };
}
