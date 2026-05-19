import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalDeal, SourceRecord } from "@clearbolt/core";
import { describe, expect, it } from "vitest";
import { DiskMetadataStore } from "../src/disk-metadata-store.js";

async function tmpRoot(): Promise<string> {
  const tmp = join(
    import.meta.dirname,
    "..",
    ".data-test",
    `md-iso-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

function source(id: string, adapter: string, externalId: string): SourceRecord {
  return {
    id,
    adapter,
    url: `https://example.com/${adapter}/${externalId}`,
    externalId,
    canonicalDealId: null,
    evidenceRef: {
      bucket: "disk",
      key: `raw/${adapter}/a.html`,
      sha256: "a".repeat(64),
      contentType: "text/html",
      sizeBytes: 1,
    },
    parsedFields: { title: `${adapter} listing ${externalId}` },
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

describe("DiskMetadataStore adapter isolation", () => {
  it("partitions sources, deals, and dedup index per adapter", async () => {
    const tmp = await tmpRoot();
    const store = new DiskMetadataStore(tmp);
    const sBbs = source("s-bbs", "bizbuysell", "100");
    const sBb = source("s-bb", "businessbroker", "100");
    await store.putSource(sBbs);
    await store.putSource(sBb);

    const dealBbs: CanonicalDeal = {
      id: "c-bbs",
      sourceIds: [sBbs.id],
      representativeSourceId: sBbs.id,
    };
    const dealBb: CanonicalDeal = {
      id: "c-bb",
      sourceIds: [sBb.id],
      representativeSourceId: sBb.id,
    };
    await store.putCanonical(dealBbs);
    await store.putCanonical(dealBb);

    await store.setDedupMapping(
      { kind: "external", adapter: "bizbuysell", externalId: "100" },
      dealBbs.id,
    );
    await store.setDedupMapping(
      { kind: "external", adapter: "businessbroker", externalId: "100" },
      dealBb.id,
    );

    const bbsDedup = JSON.parse(
      await readFile(join(tmp, "index", "bizbuysell", "dedup.json"), "utf8"),
    ) as Record<string, string>;
    const bbDedup = JSON.parse(
      await readFile(
        join(tmp, "index", "businessbroker", "dedup.json"),
        "utf8",
      ),
    ) as Record<string, string>;

    expect(Object.values(bbsDedup)).toEqual([dealBbs.id]);
    expect(Object.values(bbDedup)).toEqual([dealBb.id]);
    expect(
      await store.getCanonicalIdForDedupKey({
        kind: "external",
        adapter: "bizbuysell",
        externalId: "100",
      }),
    ).toBe(dealBbs.id);
    expect(
      await store.getCanonicalIdForDedupKey({
        kind: "external",
        adapter: "businessbroker",
        externalId: "100",
      }),
    ).toBe(dealBb.id);

    await expect(
      readFile(join(tmp, "sources", "bizbuysell", `${sBbs.id}.json`), "utf8"),
    ).resolves.toBeTruthy();
    await expect(
      readFile(
        join(tmp, "sources", "businessbroker", `${sBb.id}.json`),
        "utf8",
      ),
    ).resolves.toBeTruthy();
    await expect(
      readFile(join(tmp, "deals", "bizbuysell", `${dealBbs.id}.json`), "utf8"),
    ).resolves.toBeTruthy();
    await expect(
      readFile(
        join(tmp, "deals", "businessbroker", `${dealBb.id}.json`),
        "utf8",
      ),
    ).resolves.toBeTruthy();

    await rm(tmp, { recursive: true, force: true });
  });
});
