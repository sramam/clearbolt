import type { DedupKey, SourceRecord } from "@clearbolt/core";

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
    const keys: DedupKey[] = [
      { kind: "url", value: normalizeListingUrl(record.url) },
    ];
    if (record.externalId) {
      keys.push({
        kind: "external",
        adapter: "bizbuysell",
        externalId: record.externalId,
      });
    }
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
