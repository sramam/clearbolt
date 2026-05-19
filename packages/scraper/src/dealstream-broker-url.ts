import { listingRefFromDealStreamUrl } from "./dealstream-listing-url.js";

/** Broker / intermediary profile pages under `/d/…` (not listing detail). */
const BROKER_PROFILE_PATH =
  /^\/d\/(?:biz-)?(?:broker|brokers|professional|professionals|intermediary|intermediaries|member|members)(?:\/[^/]+){2,}\/?$/i;

export function isDealStreamBrokerProfileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("dealstream.com")) return false;
    return BROKER_PROFILE_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export function normalizeDealStreamBrokerProfileUrl(url: string): string | null {
  if (!isDealStreamBrokerProfileUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return u.toString();
}

export function extractListingIdFromDealStreamUrl(url: string): string | undefined {
  return listingRefFromDealStreamUrl(url)?.externalId;
}
