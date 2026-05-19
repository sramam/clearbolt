import type { BrokerDirectoryRef } from "@clearbolt/scraper";
import { mergeBrokerDirectoryRef } from "@clearbolt/scraper";
import * as cheerio from "cheerio";
import { websiteDomainFromUrl } from "../website-domain.js";

export const SUNBELT_LOCATIONS_URL =
  "https://www.sunbeltnetwork.com/locations/";

/** Franchise office pages: /city-st/ or linked from locations index. */
const SUNBELT_OFFICE_PATH = /^\/[a-z0-9][a-z0-9-]*\/$/i;

const SUNBELT_SKIP_SEGMENTS = new Set([
  "locations",
  "blog",
  "wp-admin",
  "login-register",
  "about",
  "contact",
  "privacy",
  "terms",
]);

export function isSunbeltOfficeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.replace(/^www\./i, "").includes("sunbeltnetwork.com")) {
      return false;
    }
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length !== 1) return false;
    if (SUNBELT_SKIP_SEGMENTS.has(seg[0]?.toLowerCase())) return false;
    return SUNBELT_OFFICE_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export function discoverSunbeltBrokerRefsFromHtml(
  html: string,
  pageUrl = SUNBELT_LOCATIONS_URL,
): BrokerDirectoryRef[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const merged = new Map<string, BrokerDirectoryRef>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, base).toString();
    } catch {
      return;
    }
    if (!isSunbeltOfficeUrl(abs)) return;
    const u = new URL(abs);
    const slug = u.pathname.split("/").filter(Boolean)[0] ?? "";
    const title = $(el).text().trim();
    mergeBrokerDirectoryRef(merged, {
      profileUrl: abs,
      externalBrokerId: slug,
      name: title || `Sunbelt ${slug}`,
      firm: "Sunbelt Business Brokers",
      sourceAdapter: "sunbelt",
      websiteDomain: websiteDomainFromUrl(u.origin),
    });
  });

  return [...merged.values()];
}

export async function fetchSunbeltBrokerRefs(options?: {
  fetchText?: (url: string) => Promise<string>;
  locationsUrl?: string;
}): Promise<BrokerDirectoryRef[]> {
  const url = options?.locationsUrl ?? SUNBELT_LOCATIONS_URL;
  const fetchText =
    options?.fetchText ??
    (async (target: string) => {
      const res = await fetch(target, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
      });
      if (!res.ok) {
        throw new Error(
          `Sunbelt locations fetch failed ${res.status} (Cloudflare may block datacenter IPs; retry with browser fetcher or --headed)`,
        );
      }
      const body = await res.text();
      if (
        body.includes("cf-error-details") ||
        body.includes("you have been blocked")
      ) {
        throw new Error(
          "Sunbelt returned Cloudflare block page — use Playwright/browser fetcher (--headed) or run from residential IP",
        );
      }
      return body;
    });
  const html = await fetchText(url);
  return discoverSunbeltBrokerRefsFromHtml(html, url);
}
