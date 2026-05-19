import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isCatalogDiscoveryComplete,
  readCatalogRefsFile,
  writeCatalogRefsFile,
} from "../src/catalog-refs-file.js";
import { walkCatalogPages } from "../src/discovery/catalog-walk.js";

describe("catalog discovery checkpoint", () => {
  it("writes incomplete checkpoint with nextPageUrl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catalog-ckpt-"));
    const path = join(dir, "refs.json");
    try {
      await writeCatalogRefsFile(path, {
        catalogUrl:
          "https://www.bizbuysell.com/california-businesses-for-sale/",
        refs: [
          {
            url: "https://www.bizbuysell.com/business-opportunity/a/1/",
            externalId: "1",
          },
        ],
        complete: false,
        pagesFetched: 1,
        lastPageUrl:
          "https://www.bizbuysell.com/california-businesses-for-sale/",
        nextPageUrl:
          "https://www.bizbuysell.com/california-businesses-for-sale/2/",
      });
      const loaded = await readCatalogRefsFile(path);
      expect(isCatalogDiscoveryComplete(loaded)).toBe(false);
      expect(loaded.nextPageUrl).toContain("/2/");
      expect(loaded.pagesFetched).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("walkCatalogPages calls onPageComplete with next url", async () => {
    const checkpoints: Array<{
      pagesFetched: number;
      nextPageUrl: string | null;
    }> = [];
    const page1 = `<html><body>
      <a href="/business-opportunity/foo/100/">Listing</a>
      <motion.div class="ngx-pagination"><a href="https://www.bizbuysell.com/california-businesses-for-sale/2/">2</a></motion.div>
    </body></html>`;
    const page2 = `<html><body><a href="/business-opportunity/bar/200/">B</a></body></html>`;

    await walkCatalogPages({
      startUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
      catalogBaseUrl:
        "https://www.bizbuysell.com/california-businesses-for-sale/",
      maxPages: 0,
      maxListings: 0,
      fetchPage: async (url) => ({
        body: url.includes("/2/") ? page2 : page1,
        finalUrl: url,
      }),
      discoverRefs: async () => [
        {
          url: "https://www.bizbuysell.com/business-opportunity/foo/100/",
          externalId: "100",
        },
      ],
      discoverNext: (_html, _pageUrl, pageNumber) =>
        pageNumber === 1
          ? "https://www.bizbuysell.com/california-businesses-for-sale/2/"
          : null,
      onPageComplete: async (d) => {
        checkpoints.push({
          pagesFetched: d.pagesFetched,
          nextPageUrl: d.nextPageUrl,
        });
      },
    });

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]?.nextPageUrl).toContain("/2/");
    expect(checkpoints[1]?.nextPageUrl).toBeNull();
  });

  it("treats legacy refs files without complete as finished", async () => {
    const dir = await mkdtemp(join(tmpdir(), "legacy-refs-"));
    const path = join(dir, "refs.json");
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          catalogUrl:
            "https://www.bizbuysell.com/california-businesses-for-sale/",
          discoveredAt: new Date().toISOString(),
          refs: [],
        }),
        "utf8",
      );
      const loaded = await readCatalogRefsFile(path);
      expect(isCatalogDiscoveryComplete(loaded)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
