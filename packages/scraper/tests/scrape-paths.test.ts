import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateNextRunId,
  createInitialScrapeMeta,
  cumulativeFromListingIndexes,
  domainFromUrl,
  listingIndexPath,
  listingRunManifestPath,
  readScrapeMeta,
  scrapeBaseDir,
  scrapeIdFromUrl,
  scrapeMetaPath,
  writeListingIndex,
  writeScrapeMeta,
} from "../src/scrape-paths.js";

describe("scrape-paths", () => {
  it("derives domain and scrape id from catalog URL", () => {
    const url = "https://www.bizbuysell.com/california-businesses-for-sale/";
    expect(domainFromUrl(url)).toBe("bizbuysell.com");
    expect(scrapeIdFromUrl(url)).toBe("california-businesses-for-sale");
  });

  it("builds stable paths under scrapes/listings", () => {
    const root = "/data";
    const base = scrapeBaseDir(
      root,
      "listings",
      "bizbuysell.com",
      "california-businesses-for-sale",
    );
    expect(base).toBe(
      "/data/scrapes/listings/bizbuysell.com/california-businesses-for-sale",
    );
    expect(
      listingIndexPath(
        root,
        "listings",
        "bizbuysell.com",
        "california-businesses-for-sale",
        "2232394",
      ),
    ).toContain("/listings/2232394/index.json");
    expect(
      listingRunManifestPath(
        root,
        "listings",
        "bizbuysell.com",
        "california-businesses-for-sale",
        "2232394",
        1,
      ),
    ).toContain("/runs/1/manifest.json");
  });

  it("allocates monotonic run ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-scrape-paths-"));
    const metaPath = scrapeMetaPath(
      dir,
      "listings",
      "bizbuysell.com",
      "test-scrape",
    );
    const at = "2026-05-18T12:00:00.000Z";
    await writeScrapeMeta(
      metaPath,
      createInitialScrapeMeta({
        lane: "listings",
        scrapeId: "test-scrape",
        domain: "bizbuysell.com",
        adapter: "bizbuysell",
        createdAt: at,
      }),
    );
    expect(await allocateNextRunId(metaPath)).toBe(1);
    expect(await allocateNextRunId(metaPath)).toBe(2);
    const meta = await readScrapeMeta(metaPath);
    expect(meta?.nextRunId).toBe(3);
    expect(meta?.latestRunId).toBe(2);
  });

  it("recomputes cumulative from listing indexes", () => {
    const at = "2026-05-18T12:00:00.000Z";
    const cumulative = cumulativeFromListingIndexes(
      [
        { status: "ingested" },
        { status: "ingested" },
        { status: "failed" },
        { status: "skipped_known" },
      ],
      10,
      at,
      1,
    );
    expect(cumulative).toMatchObject({
      discovered: 10,
      ingested: 2,
      failed: 1,
      skippedKnown: 1,
      skippedFresh: 0,
      satisfied: 3,
      lastCompletedRunId: 1,
    });
  });

  it("round-trips listing index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-scrape-paths-"));
    const path = listingIndexPath(
      dir,
      "listings",
      "bizbuysell.com",
      "ca",
      "99",
    );
    const at = "2026-05-18T12:00:00.000Z";
    await writeListingIndex(path, {
      version: 1,
      listingId: "99",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/business-opportunity/x/99/",
      status: "ingested",
      lastAttemptRunId: 1,
      lastSuccessRunId: 1,
      updatedAt: at,
    });
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.status).toBe("ingested");
  });
});
