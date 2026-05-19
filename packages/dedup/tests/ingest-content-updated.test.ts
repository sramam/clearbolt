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

describe("ingest contentUpdated", () => {
  it("flags when merged source body fingerprint differs from representative", async () => {
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `dedup-cu-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskMetadataStore(tmp);
    const keyer = new BizBuySellDedupKeyer();
    const url =
      "https://www.bizbuysell.com/california-business-for-sale/1234567/";

    const s1: SourceRecord = {
      id: "src-1",
      adapter: "bizbuysell",
      url,
      externalId: "1234567",
      canonicalDealId: null,
      evidenceRef: evRef(),
      parsedFields: { title: "Acme Plumbing Services" },
      bodyFingerprint:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const r1 = await ingestSourceRecord(store, s1, { keyer });
    expect(r1.action).toBe("new");
    expect(r1.contentUpdated).toBeUndefined();

    const s2: SourceRecord = {
      id: "src-2",
      adapter: "bizbuysell",
      url,
      externalId: "1234567",
      canonicalDealId: null,
      evidenceRef: evRef(),
      parsedFields: { title: "Acme Plumbing Services" },
      bodyFingerprint:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const r2 = await ingestSourceRecord(store, s2, { keyer });
    expect(r2.action).toBe("merged");
    expect(r2.contentUpdated).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  });
});
