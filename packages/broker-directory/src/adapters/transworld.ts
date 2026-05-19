import type { BrokerDirectoryRef } from "@clearbolt/scraper";
import { mergeBrokerDirectoryRef } from "@clearbolt/scraper";
import { websiteDomainFromUrl } from "../website-domain.js";

export const TRANSWORLD_LOCATIONS_SITEMAP_URL =
  "https://www.tworld.com/sitemap/locations.xml";

/** Office root: /locations/{state}/{city} — not nested marketing paths. */
const TRANSWORLD_OFFICE_PATH =
  /^\/locations\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i;

export function isTransworldOfficeLocationUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("tworld.com")) return false;
    return TRANSWORLD_OFFICE_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export function parseTransworldLocationUrlsFromSitemap(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1]!.trim();
    if (isTransworldOfficeLocationUrl(loc)) urls.push(loc);
  }
  return [...new Set(urls)];
}

export function transworldOfficeUrlToRef(officeUrl: string): BrokerDirectoryRef {
  const u = new URL(officeUrl);
  const segments = u.pathname.split("/").filter(Boolean);
  const state = segments[1];
  const city = segments[2];
  const label = [city, state].filter(Boolean).join(", ");
  return {
    profileUrl: u.toString(),
    externalBrokerId: `${state}/${city}`,
    name: label ? `Transworld ${label}` : "Transworld office",
    firm: "Transworld Business Advisors",
    state: state?.toUpperCase(),
    city,
    sourceAdapter: "transworld",
    websiteDomain: websiteDomainFromUrl(u.origin),
  };
}

export function discoverTransworldBrokerRefsFromSitemap(
  xml: string,
): BrokerDirectoryRef[] {
  const merged = new Map<string, BrokerDirectoryRef>();
  for (const url of parseTransworldLocationUrlsFromSitemap(xml)) {
    mergeBrokerDirectoryRef(merged, transworldOfficeUrlToRef(url));
  }
  return [...merged.values()];
}

export async function fetchTransworldBrokerRefs(options?: {
  fetchText?: (url: string) => Promise<string>;
}): Promise<BrokerDirectoryRef[]> {
  const fetchText =
    options?.fetchText ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { "User-Agent": "Clearbolt/1.0 (broker-directory; +https://clearbolt.dev)" },
      });
      if (!res.ok) {
        throw new Error(`Transworld sitemap fetch failed ${res.status}: ${url}`);
      }
      return res.text();
    });
  const xml = await fetchText(TRANSWORLD_LOCATIONS_SITEMAP_URL);
  return discoverTransworldBrokerRefsFromSitemap(xml);
}
