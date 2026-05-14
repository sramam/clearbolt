import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalDeal, DedupKey, SourceRecord } from "@clearbolt/core";
import { describe, expect, it } from "vitest";
import { DiskMetadataStore } from "../src/disk-metadata-store.js";

describe("DiskMetadataStore conformance", () => {
  it("sources, canonicals, dedup index round-trip", async () => {
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `md-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskMetadataStore(tmp);

    const sr: SourceRecord = {
      id: "s1",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/x",
      externalId: "123",
      canonicalDealId: null,
      evidenceRef: {
        bucket: "disk",
        key: "raw/bizbuysell/abc.html",
        sha256: "a".repeat(64),
        contentType: "text/html",
        sizeBytes: 3,
      },
      parsedFields: { title: "Test Co" },
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    await store.putSource(sr);
    const got = await store.getSource("s1");
    expect(got?.id).toBe("s1");

    const deal: CanonicalDeal = {
      id: "c1",
      sourceIds: ["s1"],
      representativeSourceId: "s1",
    };
    await store.putCanonical(deal);
    expect((await store.getCanonical("c1"))?.id).toBe("c1");
    expect(await store.listCanonicalIds()).toContain("c1");

    const key: DedupKey = {
      kind: "external",
      adapter: "bizbuysell",
      externalId: "123",
    };
    expect(await store.getCanonicalIdForDedupKey(key)).toBeNull();
    await store.setDedupMapping(key, "c1");
    expect(await store.getCanonicalIdForDedupKey(key)).toBe("c1");

    await rm(tmp, { recursive: true, force: true });
  });
});
