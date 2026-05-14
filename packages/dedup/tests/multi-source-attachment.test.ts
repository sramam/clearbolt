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

describe("multi-source attachment", () => {
  it("second source with same external id merges to one canonical", async () => {
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `dedup-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskMetadataStore(tmp);
    const keyer = new BizBuySellDedupKeyer();

    const s1: SourceRecord = {
      id: "src-1",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/california-business-for-sale/1234567/",
      externalId: "1234567",
      canonicalDealId: null,
      evidenceRef: evRef(),
      parsedFields: { title: "Acme Plumbing Services" },
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const r1 = await ingestSourceRecord(store, s1, { keyer });
    expect(r1.action).toBe("new");

    const s2: SourceRecord = {
      id: "src-2",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/florida-business-for-sale/1234567/",
      externalId: "1234567",
      canonicalDealId: null,
      evidenceRef: evRef(),
      parsedFields: { title: "Acme Plumbing Services FL" },
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const r2 = await ingestSourceRecord(store, s2, { keyer });
    expect(r2.action).toBe("merged");
    expect(r2.canonicalId).toBe(r1.canonicalId);

    const deal = await store.getCanonical(r1.canonicalId);
    expect(deal?.sourceIds).toContain("src-1");
    expect(deal?.sourceIds).toContain("src-2");

    await rm(tmp, { recursive: true, force: true });
  });
});
