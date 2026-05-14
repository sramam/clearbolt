import { randomUUID } from "node:crypto";
import type { CanonicalDeal, SourceRecord } from "@clearbolt/core";
import type { MetadataStore } from "@clearbolt/storage";
import type { DedupKeyer } from "./keyer.js";
import { mergeDecide, scorePair } from "./scorer.js";

export interface IngestSourceOptions {
  keyer: DedupKeyer;
}

/**
 * Ingest a new source record: deterministic key match, else lexical match against existing deals, else new canonical.
 */
export async function ingestSourceRecord(
  store: MetadataStore,
  record: SourceRecord,
  opts: IngestSourceOptions,
): Promise<{ canonicalId: string; action: "new" | "merged" | "review" }> {
  const keys = opts.keyer.keys(record);
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
    await attachSourceToCanonical(store, record, canonicalId, opts.keyer);
    return { canonicalId, action: "merged" };
  }
  if (keyHits.size > 1) {
    const [canonicalId] = keyHits;
    if (canonicalId === undefined) {
      throw new Error("ingestSourceRecord: keyHits.size>1 but no id");
    }
    await attachSourceToCanonical(store, record, canonicalId, opts.keyer);
    return { canonicalId, action: "review" };
  }

  const candidateIds = await store.listCanonicalIds();
  let bestId: string | null = null;
  let bestScore = 0;
  for (const cid of candidateIds) {
    const deal = await store.getCanonical(cid);
    if (!deal) continue;
    const rep = await store.getSource(deal.representativeSourceId);
    if (!rep) continue;
    const { overall } = scorePair(record, rep);
    const decision = mergeDecide(overall);
    if (decision === "auto_merge" && overall > bestScore) {
      bestScore = overall;
      bestId = cid;
    }
  }
  if (bestId) {
    await attachSourceToCanonical(store, record, bestId, opts.keyer);
    for (const key of keys) {
      await store.setDedupMapping(key, bestId);
    }
    return { canonicalId: bestId, action: "merged" };
  }

  const canonicalId = randomUUID();
  const deal: CanonicalDeal = {
    id: canonicalId,
    sourceIds: [record.id],
    representativeSourceId: record.id,
    mergedAt: new Date().toISOString(),
  };
  await store.putCanonical(deal);
  for (const key of keys) {
    await store.setDedupMapping(key, canonicalId);
  }
  const updated: SourceRecord = { ...record, canonicalDealId: canonicalId };
  await store.putSource(updated);
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
  await store.putCanonical(updatedDeal);
  const updatedRecord: SourceRecord = {
    ...record,
    canonicalDealId: canonicalId,
  };
  await store.putSource(updatedRecord);
  for (const k of keyer.keys(record)) {
    await store.setDedupMapping(k, canonicalId);
  }
}
