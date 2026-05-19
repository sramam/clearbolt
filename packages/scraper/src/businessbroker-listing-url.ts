import type { ListingRef } from "@clearbolt/core";

export const BUSINESSBROKER_HOST = "businessbroker.net";

const LISTING_PATH = /\/business-for-sale\/[^/]+\/(\d+)\.aspx$/i;

const CATALOG_PATH =
  /^\/(state|industry|keyword|city|county)\/[^/]+-businesses-for-sale\.aspx$/i;

export const BUSINESSBROKER_CALIFORNIA_CATALOG_URL =
  "https://www.businessbroker.net/state/california-businesses-for-sale.aspx";

export function extractBusinessBrokerListingIdFromPathname(
  pathname: string,
): string | undefined {
  const m = pathname.match(LISTING_PATH);
  return m?.[1];
}

export function isBusinessBrokerListingPathname(pathname: string): boolean {
  return LISTING_PATH.test(pathname);
}

export function isBusinessBrokerCatalogUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(BUSINESSBROKER_HOST)) return false;
    return CATALOG_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export function isBusinessBrokerListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(BUSINESSBROKER_HOST)) return false;
    return isBusinessBrokerListingPathname(u.pathname);
  } catch {
    return false;
  }
}

export function listingRefFromBusinessBrokerUrl(
  url: string,
): ListingRef | null {
  if (!isBusinessBrokerListingUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  if (!u.hostname.startsWith("www.")) {
    u.hostname = `www.${u.hostname.replace(/^www\./, "")}`;
  }
  const externalId = extractBusinessBrokerListingIdFromPathname(u.pathname);
  return { url: u.toString(), externalId };
}
