import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceRef, SourceRecord } from "@clearbolt/core";
import { DiskMetadataStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import { BizBuySellDedupKeyer, ingestSourceRecord } from "../src/index.js";

function evRef(): EvidenceRef {
  const sha = randomBytes(32).toString("hex");
  return {
    bucket: "disk",
    key: `raw/bizbuysell/${sha}.html`,
    sha256: sha,
    contentType: "text/html",
    sizeBytes: 10,
  };
}

const fpA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fpB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("ingest listing id merge and updates", () => {
  it("merges www vs mobile by external id; contentUpdated only when body changes", async () => {
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `dedup-lid-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskMetadataStore(tmp);
    const keyer = new BizBuySellDedupKeyer();

    const base = {
      adapter: "bizbuysell",
      canonicalDealId: null,
      evidenceRef: evRef(),
      parsedFields: { title: "Pool Co" },
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    } satisfies Partial<SourceRecord>;

    const s1: SourceRecord = {
      ...base,
      id: "src-1",
      url: "https://www.bizbuysell.com/business-opportunity/pool/1234567/",
      externalId: "1234567",
      bodyFingerprint: fpA,
    } as SourceRecord;

    const r1 = await ingestSourceRecord(store, s1, { keyer });
    expect(r1.action).toBe("new");

    const s2: SourceRecord = {
      ...base,
      id: "src-2",
      url: "https://m.bizbuysell.com/business-opportunity/pool/1234567/",
      externalId: "1234567",
      evidenceRef: evRef(),
      bodyFingerprint: fpA,
    } as SourceRecord;

    const r2 = await ingestSourceRecord(store, s2, { keyer });
    expect(r2.action).toBe("merged");
    expect(r2.canonicalId).toBe(r1.canonicalId);
    expect(r2.contentUpdated).toBe(false);

    const s3: SourceRecord = {
      ...base,
      id: "src-3",
      url: "https://m.bizbuysell.com/business-opportunity/pool/1234567/",
      externalId: "1234567",
      evidenceRef: evRef(),
      bodyFingerprint: fpB,
    } as SourceRecord;

    const r3 = await ingestSourceRecord(store, s3, { keyer });
    expect(r3.action).toBe("merged");
    expect(r3.contentUpdated).toBe(true);

    const deal = await store.getCanonical(r1.canonicalId);
    expect(deal?.sourceIds).toEqual(["src-1", "src-2", "src-3"]);

    await rm(tmp, { recursive: true, force: true });
  });
});
