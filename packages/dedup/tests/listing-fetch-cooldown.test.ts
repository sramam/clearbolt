import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceRef, SourceRecord } from "@clearbolt/core";
import { DiskMetadataStore } from "@clearbolt/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BizBuySellDedupKeyer,
  ingestSourceRecord,
  latestListingFetchAt,
  listingFetchMinIntervalMs,
  shouldSkipListingFetch,
} from "../src/index.js";

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

describe("listing fetch cooldown", () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
    vi.unstubAllEnvs();
  });

  it("defaults to 24 hours", () => {
    delete process.env.CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS;
    delete process.env.CLEARBOLT_LISTING_FETCH_MIN_INTERVAL_MS;
    delete process.env.CLEARBOLT_LISTING_FETCH_COOLDOWN;
    expect(listingFetchMinIntervalMs()).toBe(24 * 60 * 60 * 1000);
  });

  it("disables when CLEARBOLT_LISTING_FETCH_COOLDOWN=0", () => {
    vi.stubEnv("CLEARBOLT_LISTING_FETCH_COOLDOWN", "0");
    expect(listingFetchMinIntervalMs()).toBe(0);
  });

  it("skips when SKIP_KNOWN and canonical exists", async () => {
    vi.stubEnv("CLEARBOLT_LISTING_FETCH_SKIP_KNOWN", "1");
    vi.stubEnv("CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS", "0");
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `skip-known-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskMetadataStore(tmp);
    const keyer = new BizBuySellDedupKeyer();
    const now = new Date().toISOString();
    await ingestSourceRecord(
      store,
      {
        id: "s1",
        adapter: "bizbuysell",
        url: "https://www.bizbuysell.com/business-opportunity/x/3333003/",
        externalId: "3333003",
        canonicalDealId: null,
        evidenceRef: evRef(),
        parsedFields: { title: "X" },
        firstSeenAt: now,
        lastSeenAt: now,
      },
      { keyer },
    );
    const { skip, reason } = await shouldSkipListingFetch(store, keyer, {
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/business-opportunity/x/3333003/",
      externalId: "3333003",
    });
    expect(skip).toBe(true);
    expect(reason).toBe("known");
    await rm(tmp, { recursive: true, force: true });
  });

  it("skips fetch when last source is within cooldown", async () => {
    vi.stubEnv("CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS", "24");
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `cooldown-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskMetadataStore(tmp);
    const keyer = new BizBuySellDedupKeyer();
    const now = new Date().toISOString();
    const record: SourceRecord = {
      id: "s1",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/business-opportunity/pool/1111001/",
      externalId: "1111001",
      canonicalDealId: null,
      evidenceRef: evRef(),
      parsedFields: { title: "Pool" },
      firstSeenAt: now,
      lastSeenAt: now,
    };
    await ingestSourceRecord(store, record, { keyer });

    const last = await latestListingFetchAt(store, keyer, {
      adapter: "bizbuysell",
      url: record.url,
      externalId: "1111001",
    });
    expect(last).not.toBeNull();

    const { skip } = await shouldSkipListingFetch(
      store,
      keyer,
      {
        adapter: "bizbuysell",
        url: "https://m.bizbuysell.com/business-opportunity/pool/1111001/",
        externalId: "1111001",
      },
      Date.now(),
    );
    expect(skip).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  });

  it("does not skip when last fetch is older than cooldown", async () => {
    vi.stubEnv("CLEARBOLT_LISTING_FETCH_COOLDOWN_HOURS", "24");
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `cooldown-old-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskMetadataStore(tmp);
    const keyer = new BizBuySellDedupKeyer();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const record: SourceRecord = {
      id: "s-old",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/business-opportunity/cafe/2222002/",
      externalId: "2222002",
      canonicalDealId: null,
      evidenceRef: evRef(),
      parsedFields: { title: "Cafe" },
      firstSeenAt: old,
      lastSeenAt: old,
    };
    await ingestSourceRecord(store, record, { keyer });

    const { skip } = await shouldSkipListingFetch(
      store,
      keyer,
      {
        adapter: "bizbuysell",
        url: record.url,
        externalId: "2222002",
      },
      Date.now(),
    );
    expect(skip).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });
});
