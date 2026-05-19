import type { DedupKey, SourceRecord } from "@clearbolt/core";

/** External / broker-listing keys before URL so listing number wins on lookup order. */
export function dedupKeysInLookupOrder(keys: DedupKey[]): DedupKey[] {
  const primary: DedupKey[] = [];
  const secondary: DedupKey[] = [];
  for (const key of keys) {
    if (key.kind === "external" || key.kind === "broker-listing") {
      primary.push(key);
    } else {
      secondary.push(key);
    }
  }
  return [...primary, ...secondary];
}

export interface DedupKeyer {
  keys(record: SourceRecord): DedupKey[];
}

/** Normalize BizBuySell listing URLs for dedup */
function normalizeListingUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.sort();
    return u.toString();
  } catch {
    return url;
  }
}

export class BizBuySellDedupKeyer implements DedupKeyer {
  keys(record: SourceRecord): DedupKey[] {
    const keys: DedupKey[] = [];
    if (record.externalId) {
      keys.push({
        kind: "external",
        adapter: "bizbuysell",
        externalId: record.externalId,
      });
    }
    keys.push({ kind: "url", value: normalizeListingUrl(record.url) });
    return keys;
  }
}

export class BizQuestDedupKeyer implements DedupKeyer {
  keys(record: SourceRecord): DedupKey[] {
    const keys: DedupKey[] = [];
    if (record.externalId) {
      keys.push({
        kind: "external",
        adapter: "bizquest",
        externalId: record.externalId,
      });
    }
    keys.push({ kind: "url", value: normalizeListingUrl(record.url) });
    return keys;
  }
}

export class BusinessBrokerDedupKeyer implements DedupKeyer {
  keys(record: SourceRecord): DedupKey[] {
    const keys: DedupKey[] = [];
    if (record.externalId) {
      keys.push({
        kind: "external",
        adapter: "businessbroker",
        externalId: record.externalId,
      });
    }
    keys.push({ kind: "url", value: normalizeListingUrl(record.url) });
    return keys;
  }
}

export class DealStreamDedupKeyer implements DedupKeyer {
  keys(record: SourceRecord): DedupKey[] {
    const keys: DedupKey[] = [];
    if (record.externalId) {
      keys.push({
        kind: "external",
        adapter: "dealstream",
        externalId: record.externalId,
      });
    }
    keys.push({ kind: "url", value: normalizeListingUrl(record.url) });
    return keys;
  }
}

export class GenericDedupKeyer implements DedupKeyer {
  constructor(private readonly adapter: string) {}
  keys(record: SourceRecord): DedupKey[] {
    const keys: DedupKey[] = [
      { kind: "url", value: normalizeListingUrl(record.url) },
    ];
    if (record.externalId) {
      keys.push({
        kind: "external",
        adapter: this.adapter,
        externalId: record.externalId,
      });
    }
    return keys;
  }
}

/** Broker-owned websites (`adapter: broker-site`). Keys by URL + optional path slug. */
export class BrokerSiteDedupKeyer implements DedupKeyer {
  keys(record: SourceRecord): DedupKey[] {
    const keys: DedupKey[] = [
      { kind: "url", value: normalizeListingUrl(record.url) },
    ];
    if (record.externalId) {
      keys.push({
        kind: "external",
        adapter: "broker-site",
        externalId: record.externalId,
      });
    }
    return keys;
  }
}
