import { listingRefFromBizBuySellUrl } from "./bizbuysell-listing-url.js";

const BROKER_PROFILE_PATH = /^\/business-broker\/[^/]+\/[^/]+\/\d+\/?$/i;
const SOLD_BUSINESS_PATH = /\/sold-business\/[^/]+\/([^/]+)\/\d+\/?$/i;

export function isBizBuySellBrokerProfileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("bizbuysell.com")) return false;
    return BROKER_PROFILE_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export function normalizeBizBuySellBrokerProfileUrl(url: string): string | null {
  if (!isBizBuySellBrokerProfileUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return u.toString();
}

/** Listing id from sold-business slug segment (often base64-encoded numeric id). */
export function listingIdFromSoldBusinessUrl(url: string): string | undefined {
  try {
    const path = new URL(url, "https://www.bizbuysell.com").pathname;
    const m = path.match(SOLD_BUSINESS_PATH);
    if (!m?.[1]) return undefined;
    const segment = m[1];
    if (/^\d{6,}$/.test(segment)) return segment;
    try {
      const decoded = Buffer.from(segment, "base64").toString("utf8").trim();
      if (/^\d{6,}$/.test(decoded)) return decoded;
    } catch {
      /* not base64 */
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Listing id from broker profile `Profile/?q=` links. */
export function listingIdFromProfileLink(url: string): string | undefined {
  const m = url.match(/[?&]q=(\d{6,})/);
  return m?.[1];
}

/** Best-effort listing id from any BizBuySell listing, sold, or profile URL. */
export function extractListingIdFromBizBuySellUrl(url: string): string | undefined {
  return (
    listingRefFromBizBuySellUrl(url)?.externalId ??
    listingIdFromProfileLink(url) ??
    listingIdFromSoldBusinessUrl(url)
  );
}
