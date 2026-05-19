import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  beginListingScrapeRun,
  completeListingScrapeRun,
  countListingIndexesOnScrape,
} from "../src/scrape-run-context.js";
import { ScrapeRunListingStateStore } from "../src/scrape-run-listing-state-store.js";
import { readListingIndex, scrapeMetaPath, readScrapeMeta } from "../src/scrape-paths.js";

const CATALOG = "https://www.bizbuysell.com/california-businesses-for-sale/";

describe("ScrapeRunListingStateStore", () => {
  it("writes index and manifest under scrapes/listings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-scrape-run-store-"));
    const ctx = await beginListingScrapeRun({
      dataRoot: dir,
      catalogUrl: CATALOG,
      runKind: "test",
    });
    const store = new ScrapeRunListingStateStore(ctx);
    await store.put({
      version: 1,
      at: "2026-05-18T12:00:00.000Z",
      adapter: "bizbuysell",
      externalId: "123",
      url: "https://www.bizbuysell.com/business-opportunity/x/123/",
      status: "ingested",
      canonicalId: "canon-1",
      evidenceRef: {
        bucket: "disk",
        key: "raw/bizbuysell/abc.html",
        sha256: "abc",
        contentType: "text/html",
        sizeBytes: 100,
      },
      processedArtifactKeys: ["processed/bizbuysell/markdown/def.md"],
    });

    const got = await store.get("bizbuysell", "123");
    expect(got?.status).toBe("ingested");
    const index = await readListingIndex(
      join(
        dir,
        "scrapes/listings/bizbuysell.com/california-businesses-for-sale/listings/123/index.json",
      ),
    );
    expect(index?.lastSuccessRunId).toBe(1);

    const overall = await completeListingScrapeRun(ctx, {
      listingsDiscovered: 1,
      listingsIngested: 1,
      listingsFailed: 0,
      listingsSkippedKnown: 0,
      listingsSkippedFresh: 0,
    });
    expect(overall.ingested).toBe(1);
    const meta = await readScrapeMeta(
      scrapeMetaPath(
        dir,
        "listings",
        "bizbuysell.com",
        "california-businesses-for-sale",
      ),
    );
    expect(meta?.cumulative.ingested).toBe(1);
    const counts = await countListingIndexesOnScrape(
      dir,
      "listings",
      "bizbuysell.com",
      "california-businesses-for-sale",
    );
    expect(counts.ingested).toBe(1);
  });
});
