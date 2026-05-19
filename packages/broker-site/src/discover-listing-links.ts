import * as cheerio from "cheerio";
import { isMarketplaceUrl, normalizeHost } from "./marketplace-hosts.js";

const LISTING_PATH_RE =
  /business|listing|opportunity|for[-_]sale|acquisition|company|deal|inventory/i;

const SKIP_EXT_RE = /\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|doc|docx)(\?|$)/i;

const SKIP_PATH_RE =
  /\/(about|contact|team|blog|news|privacy|terms|login|cart|checkout|careers|faq)\/?$/i;

export type BrokerSiteListingLink = {
  url: string;
  title?: string;
};

function listingSlugFromPath(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  const last = segments[segments.length - 1]!;
  if (/^\d{4,}$/.test(last)) return last;
  if (last.length >= 8 && /^[a-z0-9-]+$/i.test(last)) return last;
  return segments.slice(-2).join("-") || last;
}

export function discoverListingLinksFromPage(
  html: string,
  pageUrl: string,
  options?: { maxLinks?: number },
): BrokerSiteListingLink[] {
  const base = new URL(pageUrl);
  const host = normalizeHost(base.hostname);
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: BrokerSiteListingLink[] = [];
  const max = options?.maxLinks ?? 500;

  $("a[href]").each((_, el) => {
    if (out.length >= max) return;
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (SKIP_EXT_RE.test(href)) return;

    let abs: string;
    try {
      abs = new URL(href, base).toString();
    } catch {
      return;
    }
    if (normalizeHost(new URL(abs).hostname) !== host) return;
    if (isMarketplaceUrl(abs)) return;

    const path = new URL(abs).pathname;
    if (SKIP_PATH_RE.test(path)) return;
    if (path === base.pathname || path === `${base.pathname}/`) return;
    if (!LISTING_PATH_RE.test(path) && !LISTING_PATH_RE.test($(el).text())) return;

    const key = abs.split("#")[0]!;
    if (seen.has(key)) return;
    seen.add(key);

    const title = $(el).text().replace(/\s+/g, " ").trim();
    out.push({
      url: key,
      title: title.length > 3 && title.length < 200 ? title : undefined,
    });
  });

  return out;
}

export function externalIdFromBrokerSiteUrl(url: string): string | undefined {
  try {
    return listingSlugFromPath(new URL(url).pathname);
  } catch {
    return undefined;
  }
}
