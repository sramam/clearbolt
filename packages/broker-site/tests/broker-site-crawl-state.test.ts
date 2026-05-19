import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readBrokerSiteCrawlState,
  writeBrokerSiteCrawlState,
} from "../src/broker-site-crawl-state.js";
import { defaultBrokerSiteCrawlStatePath } from "../src/broker-site-crawl-path.js";

describe("broker-site crawl state", () => {
  it("round-trips pagination checkpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-broker-site-"));
    const path = join(dir, "broker-site-crawls", "example.com__listings.json");
    try {
      await writeBrokerSiteCrawlState(path, {
        siteUrl: "https://example.com/listings",
        listingUrls: ["https://example.com/deal/a"],
        indexPagination: [
          {
            indexUrl: "https://example.com/listings",
            pagesFetched: 2,
            lastPageUrl: "https://example.com/listings?page=2",
            nextPageUrl: "https://example.com/listings?page=3",
            complete: false,
            lastPaginationStrategy: "query-page",
          },
        ],
        complete: false,
      });
      const loaded = await readBrokerSiteCrawlState(path);
      expect(loaded.listingUrls).toHaveLength(1);
      expect(loaded.indexPagination[0]?.lastPaginationStrategy).toBe("query-page");
      expect(loaded.indexPagination[0]?.pagesFetched).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("default path slug is stable", () => {
    const p = defaultBrokerSiteCrawlStatePath(
      "https://www.acme-broker.com/businesses-for-sale/",
      "data",
    );
    expect(p).toMatch(
      /broker-site-crawls\/acme-broker\.com__businesses-for-sale\.json$/,
    );
  });
});
