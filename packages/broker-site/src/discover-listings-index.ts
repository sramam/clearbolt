import * as cheerio from "cheerio";
import { isMarketplaceUrl, normalizeHost } from "./marketplace-hosts.js";

const INDEX_PATH_CANDIDATES = [
  "/businesses-for-sale",
  "/businesses-for-sale/",
  "/business-listings",
  "/business-listings/",
  "/listings",
  "/listings/",
  "/current-listings",
  "/current-listings/",
  "/active-listings",
  "/active-listings/",
  "/companies-for-sale",
  "/companies-for-sale/",
  "/for-sale",
  "/for-sale/",
  "/business-opportunities",
  "/business-opportunities/",
  "/sell-a-business",
  "/sell-a-business/",
] as const;

const INDEX_LINK_RE =
  /business(es)?[- ]for[- ]sale|listings?|opportunities|companies[- ]for[- ]sale|current[- ]listings|active[- ]listings/i;

export function discoverListingIndexUrls(
  html: string,
  baseUrl: string,
): string[] {
  const base = new URL(baseUrl);
  const host = normalizeHost(base.hostname);
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string) => {
    try {
      const u = new URL(raw, base);
      if (normalizeHost(u.hostname) !== host) return;
      if (isMarketplaceUrl(u.toString())) return;
      u.hash = "";
      const key = u.pathname.replace(/\/+$/, "") || "/";
      if (seen.has(key)) return;
      seen.add(key);
      out.push(u.toString());
    } catch {
      /* skip */
    }
  };

  for (const path of INDEX_PATH_CANDIDATES) {
    add(new URL(path, base).toString());
  }

  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const abs = new URL(href, base).toString();
    if (isMarketplaceUrl(abs)) return;
    if (INDEX_LINK_RE.test(text) || INDEX_LINK_RE.test(href)) {
      add(abs);
    }
  });

  add(base.toString());
  return out;
}
