import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SourceRecord } from "@clearbolt/core";
import { DiskMetadataStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import { BizBuySellDedupKeyer, BusinessBrokerDedupKeyer } from "../src/keyer.js";
import { ingestSourceRecord } from "../src/ingest.js";

async function tmpRoot(): Promise<string> {
  const tmp = join(
    import.meta.dirname,
    "..",
    ".data-test",
    `dedup-iso-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

function record(adapter: string, externalId: string): SourceRecord {
  return {
    id: `${adapter}-${externalId}`,
    adapter,
    url: `https://${adapter}.example/listing/${externalId}`,
    externalId,
    canonicalDealId: null,
    evidenceRef: {
      bucket: "disk",
      key: `raw/${adapter}/x.html`,
      sha256: randomBytes(32).toString("hex"),
      contentType: "text/html",
      sizeBytes: 1,
    },
    parsedFields: {
      title: "Joe's Pizza",
      city: "Sacramento",
      state: "CA",
      askingPrice: 500_000,
    },
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

describe("adapter isolation", () => {
  it("does not lexical-merge across adapters with the same title", async () => {
    const tmp = await tmpRoot();
    const store = new DiskMetadataStore(tmp);
    const bbs = record("bizbuysell", "9001");
    const bb = record("businessbroker", "9002");

    const r1 = await ingestSourceRecord(store, bbs, {
      keyer: new BizBuySellDedupKeyer(),
    });
    const r2 = await ingestSourceRecord(store, bb, {
      keyer: new BusinessBrokerDedupKeyer(),
    });

    expect(r1.action).toBe("new");
    expect(r2.action).toBe("new");
    expect(r1.canonicalId).not.toBe(r2.canonicalId);
    expect((await store.listCanonicalIds()).length).toBe(2);

    await rm(tmp, { recursive: true, force: true });
  });
});
