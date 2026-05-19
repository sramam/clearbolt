import type { ListingRef } from "@clearbolt/core";
import { listingRefFromKnownSourceUrl } from "../listing-ref-from-url.js";

/** Stable key for deduping listing refs (external id preferred). */
export function listingRefDedupeKey(ref: ListingRef): string {
  if (ref.externalId) return `id:${ref.externalId}`;
  const parsed = listingRefFromKnownSourceUrl(ref.url);
  if (parsed?.externalId) return `id:${parsed.externalId}`;
  return `url:${ref.url}`;
}

function dedupeKey(ref: ListingRef): string {
  return listingRefDedupeKey(ref);
}

export type ListingRefsOnPageCounts = {
  total: number;
  newOnPage: number;
  seenOnPage: number;
};

/**
 * How many refs on this page were not already in `merged` (and optional seed set)
 * before merging this page — used to stop discovery on stale catalog tails.
 */
export function countListingRefsNewOnPage(
  merged: Map<string, ListingRef>,
  pageRefs: ListingRef[],
  options?: {
    seedKnownKeys?: ReadonlySet<string>;
    mergeRef?: MergeListingRef;
  },
): ListingRefsOnPageCounts {
  const mergeRef = options?.mergeRef ?? mergeListingRefByExternalId;
  const seed = options?.seedKnownKeys;
  let newOnPage = 0;
  let seenOnPage = 0;
  for (const ref of pageRefs) {
    const scratch = new Map<string, ListingRef>();
    mergeRef(scratch, ref);
    const key = scratch.keys().next().value;
    if (key === undefined) continue;
    if (merged.has(key) || seed?.has(key)) {
      seenOnPage++;
    } else {
      newOnPage++;
    }
  }
  return { total: pageRefs.length, newOnPage, seenOnPage };
}

export type MergeListingRef = (
  into: Map<string, ListingRef>,
  ref: ListingRef,
) => void;

function preferListingRef(
  existing: ListingRef,
  incoming: ListingRef,
): ListingRef {
  const externalId = incoming.externalId ?? existing.externalId;
  const incomingWww = incoming.url.includes("www.bizbuysell.com");
  const existingWww = existing.url.includes("www.bizbuysell.com");
  if (incomingWww && !existingWww) {
    return { url: incoming.url, externalId };
  }
  return { url: existing.url, externalId };
}

/** Merge by normalized listing URL (last write wins per URL). */
export function mergeListingRefByUrl(
  into: Map<string, ListingRef>,
  ref: ListingRef,
): void {
  into.set(ref.url, ref);
}

/**
 * Merge by BizBuySell listing number (`externalId`) when present; otherwise URL.
 * Collapses www/mobile and duplicate anchors for the same listing.
 */
export function mergeListingRefByExternalId(
  into: Map<string, ListingRef>,
  ref: ListingRef,
): void {
  const parsed = listingRefFromKnownSourceUrl(ref.url);
  const normalized: ListingRef = parsed ?? {
    url: ref.url,
    externalId: ref.externalId,
  };
  const key = dedupeKey(normalized);
  const existing = into.get(key);
  if (!existing) {
    into.set(key, normalized);
    return;
  }
  into.set(key, preferListingRef(existing, normalized));
}

export function mergeListingRefsIntoMap(
  into: Map<string, ListingRef>,
  refs: Iterable<ListingRef>,
  merge: (
    into: Map<string, ListingRef>,
    ref: ListingRef,
  ) => void = mergeListingRefByExternalId,
): void {
  for (const ref of refs) {
    merge(into, ref);
  }
}
