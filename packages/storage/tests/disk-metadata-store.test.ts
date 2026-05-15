import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalDeal, DedupKey, SourceRecord } from "@clearbolt/core";
import { describe, expect, it } from "vitest";
import { DiskMetadataStore } from "../src/disk-metadata-store.js";

async function tmpRoot(): Promise<string> {
  const tmp = join(
    import.meta.dirname,
    "..",
    ".data-test",
    `md-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

describe("DiskMetadataStore", () => {
  describe("conformance", () => {
    it("sources, canonicals, dedup index round-trip", async () => {
      const tmp = await tmpRoot();
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

    it("domain profile round-trip", async () => {
      const tmp = await tmpRoot();
      const store = new DiskMetadataStore(tmp);
      const profile = {
        host: "www.bizbuysell.com",
        needsBrowser: true,
        lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      };
      await store.putDomainProfile(profile);
      const read = await store.getDomainProfile("www.bizbuysell.com");
      expect(read).toEqual(profile);
      await rm(tmp, { recursive: true, force: true });
    });

    it("listSourceIds includes all written sources", async () => {
      const tmp = await tmpRoot();
      const store = new DiskMetadataStore(tmp);
      const base = {
        adapter: "bizbuysell",
        url: "https://example.com/a",
        canonicalDealId: null,
        evidenceRef: {
          bucket: "disk",
          key: "raw/x",
          sha256: "b".repeat(64),
          contentType: "text/html",
          sizeBytes: 1,
        },
        parsedFields: {},
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      await store.putSource({
        ...base,
        id: "s-a",
        url: "https://a",
      });
      await store.putSource({
        ...base,
        id: "s-b",
        url: "https://b",
      });
      const ids = await store.listSourceIds();
      expect(ids.sort()).toEqual(["s-a", "s-b"]);
      await rm(tmp, { recursive: true, force: true });
    });
  });
});
