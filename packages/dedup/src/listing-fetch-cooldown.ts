import type { SourceRecord } from "@clearbolt/core";
import type { MetadataStore } from "@clearbolt/storage";
import type { DedupKeyer } from "./keyer.js";
import { dedupKeysInLookupOrder } from "./keyer.js";

const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Minimum time between listing detail fetches (0 = always fetch). */
export function listingFetchMinIntervalMs(): number {
  const disable =
    process.env.CLEARBOLT_LISTING_FETCH_COOLDOWN?.trim() === "0" ||
    process.env.CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS?.trim() === "0";
  if (disable) return 0;

  const rawMs = process.env.CLEARBOLT_LISTING_FETCH_MIN_INTERVAL_MS?.trim();
  if (rawMs !== undefined && rawMs !== "") {
    const n = Number.parseInt(rawMs, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }

  const rawHours = process.env.CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS?.trim();
  if (rawHours !== undefined && rawHours !== "") {
    const h = Number.parseFloat(rawHours);
    if (!Number.isNaN(h) && h >= 0) return Math.round(h * 60 * 60 * 1000);
  }

  return DEFAULT_COOLDOWN_MS;
}

/** Skip any listing that already has a canonical deal (resume ingest without re-fetch). */
export function listingFetchSkipKnown(): boolean {
  return process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN?.trim() === "1";
}

/** Latest `lastSeenAt` among sources attached to the canonical deal for this listing, if any. */
export async function latestListingFetchAt(
  store: MetadataStore,
  keyer: DedupKeyer,
  lookup: Pick<SourceRecord, "adapter" | "url" | "externalId">,
): Promise<Date | null> {
  const stub = {
    id: "",
    adapter: lookup.adapter,
    url: lookup.url,
    externalId: lookup.externalId,
    canonicalDealId: null,
    evidenceRef: {
      bucket: "",
      key: "",
      sha256: "",
      contentType: "text/html",
      sizeBytes: 0,
    },
    parsedFields: {},
    firstSeenAt: "",
    lastSeenAt: "",
  } satisfies SourceRecord;

  let canonicalId: string | null = null;
  for (const key of dedupKeysInLookupOrder(keyer.keys(stub))) {
    const id = await store.getCanonicalIdForDedupKey(key);
    if (id) {
      canonicalId = id;
      break;
    }
  }
  if (!canonicalId) return null;

  const deal = await store.getCanonical(canonicalId);
  if (!deal) return null;

  let latest: Date | null = null;
  for (const sourceId of deal.sourceIds) {
    const source = await store.getSource(sourceId);
    if (!source) continue;
    const at = new Date(source.lastSeenAt);
    if (Number.isNaN(at.getTime())) continue;
    if (!latest || at > latest) latest = at;
  }
  return latest;
}

export type ListingFetchSkipReason = "known" | "fresh";

export async function shouldSkipListingFetch(
  store: MetadataStore,
  keyer: DedupKeyer,
  lookup: Pick<SourceRecord, "adapter" | "url" | "externalId">,
  nowMs: number = Date.now(),
): Promise<{
  skip: boolean;
  reason?: ListingFetchSkipReason;
  lastFetchAt: Date | null;
  minIntervalMs: number;
}> {
  const minIntervalMs = listingFetchMinIntervalMs();
  const lastFetchAt = await latestListingFetchAt(store, keyer, lookup);
  if (!lastFetchAt) {
    return { skip: false, lastFetchAt: null, minIntervalMs };
  }
  if (listingFetchSkipKnown()) {
    return { skip: true, reason: "known", lastFetchAt, minIntervalMs };
  }
  if (minIntervalMs <= 0) {
    return { skip: false, lastFetchAt, minIntervalMs };
  }
  const skip = nowMs - lastFetchAt.getTime() < minIntervalMs;
  return {
    skip,
    reason: skip ? "fresh" : undefined,
    lastFetchAt,
    minIntervalMs,
  };
}
