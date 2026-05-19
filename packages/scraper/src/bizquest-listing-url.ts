import type { ListingRef } from "@clearbolt/core";

const LISTING_SEGMENT = /\/(business-for-sale|start-up-business)\//i;
const EXTERNAL_ID = /\/(BW\d+)\/?$/i;

/** BizQuest listing id from pathname (e.g. `BW2486214`). */
export function extractBizQuestListingIdFromPathname(
  pathname: string,
): string | undefined {
  if (!isBizQuestListingPathname(pathname)) return undefined;
  return pathname.match(EXTERNAL_ID)?.[1];
}

export function isBizQuestListingPathname(pathname: string): boolean {
  return LISTING_SEGMENT.test(pathname) && EXTERNAL_ID.test(pathname);
}

export function isBizQuestListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("bizquest.com")) return false;
    return isBizQuestListingPathname(u.pathname);
  } catch {
    return false;
  }
}

export function listingRefFromBizQuestUrl(url: string): ListingRef | null {
  if (!isBizQuestListingUrl(url)) return null;
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  const externalId = extractBizQuestListingIdFromPathname(u.pathname);
  return { url: u.toString(), externalId };
}
