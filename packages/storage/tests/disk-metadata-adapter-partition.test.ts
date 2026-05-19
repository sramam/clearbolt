import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalDeal, SourceRecord } from "@clearbolt/core";
import { describe, expect, it } from "vitest";
import { DiskMetadataStore } from "../src/disk-metadata-store.js";

async function tmpRoot(): Promise<string> {
  const tmp = join(
    import.meta.dirname,
    "..",
    ".data-test",
    `partition-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

describe("DiskMetadataStore adapter partition", () => {
  it("stores sources and dedup indexes per adapter; canonicals are global", async () => {
    const tmp = await tmpRoot();
    const store = new DiskMetadataStore(tmp);
    const bbs: SourceRecord = {
      id: "s-bbs",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/x/1/",
      externalId: "1",
      canonicalDealId: null,
      evidenceRef: {
        bucket: "disk",
        key: "raw/bizbuysell/a.html",
        sha256: "a".repeat(64),
        contentType: "text/html",
        sizeBytes: 1,
      },
      parsedFields: {},
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    const bq: SourceRecord = {
      ...bbs,
      id: "s-bq",
      adapter: "bizquest",
      url: "https://www.bizquest.com/business-for-sale/x/BW1/",
      externalId: "BW1",
      evidenceRef: { ...bbs.evidenceRef, key: "raw/bizquest/b.html" },
    };
    await store.putSource(bbs);
    await store.putSource(bq);

    await stat(join(tmp, "sources", "bizbuysell", "s-bbs.json"));
    await stat(join(tmp, "sources", "bizquest", "s-bq.json"));

    const deal: CanonicalDeal = {
      id: "c1",
      sourceIds: ["s-bbs", "s-bq"],
      representativeSourceId: "s-bbs",
    };
    await store.putCanonical(deal);
    await stat(join(tmp, "deals", "bizbuysell", "c1.json"));

    await store.setDedupMapping(
      { kind: "external", adapter: "bizbuysell", externalId: "1" },
      "c1",
    );
    await store.setDedupMapping(
      { kind: "external", adapter: "bizquest", externalId: "BW1" },
      "c1",
    );
    await stat(join(tmp, "index", "bizbuysell", "dedup.json"));
    await stat(join(tmp, "index", "bizquest", "dedup.json"));

    const rawBbs = await readFile(
      join(tmp, "sources", "bizbuysell", "s-bbs.json"),
      "utf8",
    );
    expect(JSON.parse(rawBbs).adapter).toBe("bizbuysell");

    await rm(tmp, { recursive: true, force: true });
  });
});
