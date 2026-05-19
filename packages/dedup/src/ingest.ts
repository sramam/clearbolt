import { randomUUID } from "node:crypto";
import type { CanonicalDeal, SourceRecord } from "@clearbolt/core";
import type { MetadataStore } from "@clearbolt/storage";
import type { DedupKeyer } from "./keyer.js";
import { dedupKeysInLookupOrder } from "./keyer.js";
import { mergeDecide, scorePairAsync } from "./scorer.js";

export interface IngestSourceOptions {
  keyer: DedupKeyer;
}

export interface IngestSourceResult {
  canonicalId: string;
  action: "new" | "merged" | "review";
  /** True when merged onto a canonical and `bodyFingerprint` differs from the representative source (re-scrape / listing body changed). */
  contentUpdated?: boolean;
}

async function representativeSource(
  store: MetadataStore,
  canonicalId: string,
): Promise<SourceRecord | null> {
  const deal = await store.getCanonical(canonicalId);
  if (!deal) return null;
  return store.getSource(deal.representativeSourceId);
}

function fingerprintChangedVersusRep(
  rep: SourceRecord | null,
  incoming: SourceRecord,
): boolean {
  if (!rep?.bodyFingerprint || !incoming.bodyFingerprint) return false;
  return rep.bodyFingerprint !== incoming.bodyFingerprint;
}

/**
 * Ingest a new source record: deterministic key match, else lexical match against existing deals, else new canonical.
 */
export async function ingestSourceRecord(
  store: MetadataStore,
  record: SourceRecord,
  opts: IngestSourceOptions,
): Promise<IngestSourceResult> {
  const keys = dedupKeysInLookupOrder(opts.keyer.keys(record));
  const keyHits = new Set<string>();
  for (const key of keys) {
    const id = await store.getCanonicalIdForDedupKey(key);
    if (id) keyHits.add(id);
  }
  if (keyHits.size === 1) {
    const [canonicalId] = keyHits;
    if (canonicalId === undefined) {
      throw new Error("ingestSourceRecord: keyHits.size===1 but no id");
    }
    const rep = await representativeSource(store, canonicalId);
    const contentUpdated = fingerprintChangedVersusRep(rep, record);
    await attachSourceToCanonical(store, record, canonicalId, opts.keyer);
    return { canonicalId, action: "merged", contentUpdated };
  }
  if (keyHits.size > 1) {
    const [canonicalId] = keyHits;
    if (canonicalId === undefined) {
      throw new Error("ingestSourceRecord: keyHits.size>1 but no id");
    }
    const rep = await representativeSource(store, canonicalId);
    const contentUpdated = fingerprintChangedVersusRep(rep, record);
    await attachSourceToCanonical(store, record, canonicalId, opts.keyer);
    return { canonicalId, action: "review", contentUpdated };
  }

  const candidateIds = await store.listCanonicalIds();
  let bestId: string | null = null;
  let bestScore = 0;
  for (const cid of candidateIds) {
    const deal = await store.getCanonical(cid);
    if (!deal) continue;
    const rep = await store.getSource(deal.representativeSourceId);
    if (!rep) continue;
    if (rep.adapter !== record.adapter) continue;
    const { overall } = await scorePairAsync(record, rep);
    const decision = mergeDecide(overall);
    if (decision === "auto_merge" && overall > bestScore) {
      bestScore = overall;
      bestId = cid;
    }
  }
  if (bestId) {
    const rep = await representativeSource(store, bestId);
    const contentUpdated = fingerprintChangedVersusRep(rep, record);
    await attachSourceToCanonical(store, record, bestId, opts.keyer);
    for (const key of keys) {
      await store.setDedupMapping(key, bestId);
    }
    return { canonicalId: bestId, action: "merged", contentUpdated };
  }

  const canonicalId = randomUUID();
  const deal: CanonicalDeal = {
    id: canonicalId,
    sourceIds: [record.id],
    representativeSourceId: record.id,
    mergedAt: new Date().toISOString(),
  };
  const updated: SourceRecord = { ...record, canonicalDealId: canonicalId };
  await store.putSource(updated);
  await store.putCanonical(deal);
  for (const key of keys) {
    await store.setDedupMapping(key, canonicalId);
  }
  return { canonicalId, action: "new" };
}

async function attachSourceToCanonical(
  store: MetadataStore,
  record: SourceRecord,
  canonicalId: string,
  keyer: DedupKeyer,
): Promise<void> {
  const deal = await store.getCanonical(canonicalId);
  if (!deal) throw new Error(`missing canonical ${canonicalId}`);
  const sourceIds = deal.sourceIds.includes(record.id)
    ? deal.sourceIds
    : [...deal.sourceIds, record.id];
  const updatedDeal: CanonicalDeal = { ...deal, sourceIds };
  const updatedRecord: SourceRecord = {
    ...record,
    canonicalDealId: canonicalId,
  };
  await store.putSource(updatedRecord);
  await store.putCanonical(updatedDeal);
  for (const k of keyer.keys(record)) {
    await store.setDedupMapping(k, canonicalId);
  }
}
