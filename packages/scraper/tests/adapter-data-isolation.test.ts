import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  readCatalogRefsFile,
  writeCatalogRefsFile,
} from "../src/catalog-refs-file.js";
import { loadCatalogRefsForAdapter } from "../src/catalog-refs-path.js";
import {
  orderListingRefsForIngest,
  readIngestFailuresCollection,
  recordIngestFailure,
  syncIngestFailuresFromDisk,
} from "../src/ingest-failure-collection.js";

describe("adapter data isolation", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("keeps ingest failures separate per adapter file", async () => {
    dir = await mkdtemp(join(tmpdir(), "cb-iso-fail-"));
    const bbsPath = join(dir, "ingest-failures", "bizbuysell.json");
    const bbPath = join(dir, "ingest-failures", "businessbroker.json");
    const sharedId = "999001";
    await recordIngestFailure(
      bbsPath,
      {
        url: "https://www.bizbuysell.com/business-opportunity/x/999001/",
        externalId: sharedId,
      },
      "bizbuysell",
      new Error("bbs timeout"),
    );
    await recordIngestFailure(
      bbPath,
      {
        url: "https://www.businessbroker.net/business-for-sale/x/999001.aspx",
        externalId: sharedId,
      },
      "businessbroker",
      new Error("bb timeout"),
    );
    const bbsCol = await readIngestFailuresCollection(bbsPath);
    const bbCol = await readIngestFailuresCollection(bbPath);
    expect(bbsCol.failures[sharedId]?.message).toContain("bbs");
    expect(bbCol.failures[sharedId]?.message).toContain("bb");
  });

  it("ignores failures from other adapters when ordering refs", () => {
    const refs = [{ url: "https://www.bizbuysell.com/business-opportunity/x/1/", externalId: "1" }];
    const ordered = orderListingRefsForIngest(refs, {
      version: 1,
      adapter: "bizbuysell",
      updatedAt: new Date().toISOString(),
      failures: {
        "1": {
          adapter: "businessbroker",
          externalId: "1",
          url: "https://www.businessbroker.net/business-for-sale/x/1.aspx",
          message: "wrong adapter",
          at: new Date().toISOString(),
          attempts: 1,
        },
      },
    }, { adapter: "bizbuysell" });
    expect(ordered.map((r) => r.externalId)).toEqual(["1"]);
  });

  it("rejects writing catalog refs outside the adapter directory", async () => {
    dir = await mkdtemp(join(tmpdir(), "cb-iso-refs-path-"));
    await expect(
      writeCatalogRefsFile(join(dir, "catalog-refs", "wrong", "x.json"), {
        adapter: "bizbuysell",
        catalogUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
        refs: [],
      }),
    ).rejects.toThrow(/catalog-refs\/bizbuysell/);
  });

  it("skips legacy flat catalog refs when loading for another adapter", async () => {
    dir = await mkdtemp(join(tmpdir(), "cb-iso-legacy-"));
    const legacyPath = join(
      dir,
      "catalog-refs",
      "california-businesses-for-sale.json",
    );
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({
        version: 1,
        adapter: "bizbuysell",
        catalogUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
        discoveredAt: new Date().toISOString(),
        refs: [
          {
            url: "https://www.bizbuysell.com/business-opportunity/x/1/",
            externalId: "1",
          },
        ],
        complete: true,
      }),
      "utf8",
    );
    const loaded = await loadCatalogRefsForAdapter(
      "https://dealstream.com/california-businesses-for-sale",
      "dealstream",
      dir,
    );
    expect(loaded).toBeUndefined();
  });

  it("drops listing refs from other adapters in catalog refs files", async () => {
    dir = await mkdtemp(join(tmpdir(), "cb-iso-refs-"));
    const path = join(dir, "catalog-refs", "bizbuysell", "california.json");
    await writeCatalogRefsFile(path, {
      adapter: "bizbuysell",
      catalogUrl: "https://www.bizbuysell.com/california-businesses-for-sale/",
      refs: [
        {
          url: "https://www.bizbuysell.com/business-opportunity/good/100/",
          externalId: "100",
        },
        {
          url: "https://www.businessbroker.net/business-for-sale/other/200.aspx",
          externalId: "200",
        },
      ],
    });
    const file = await readCatalogRefsFile(path);
    expect(file.adapter).toBe("bizbuysell");
    expect(file.refs).toHaveLength(1);
    expect(file.refs[0]?.externalId).toBe("100");
  });

  it("syncs ingest failures only from the matching listing-ingest-state adapter dir", async () => {
    dir = await mkdtemp(join(tmpdir(), "cb-iso-state-"));
    const stateRoot = join(dir, "listing-ingest-state", "bizbuysell", "42");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(
      join(stateRoot, "state.json"),
      JSON.stringify({
        version: 1,
        adapter: "bizbuysell",
        externalId: "42",
        url: "https://www.bizbuysell.com/business-opportunity/x/42/",
        status: "failed",
        at: new Date().toISOString(),
        failure: { message: "waf", at: new Date().toISOString() },
      }),
      "utf8",
    );
    const outPath = join(dir, "ingest-failures", "bizbuysell.json");
    const col = await syncIngestFailuresFromDisk(dir, "bizbuysell", outPath);
    expect(col.adapter).toBe("bizbuysell");
    expect(col.failures["42"]?.adapter).toBe("bizbuysell");
    const other = await syncIngestFailuresFromDisk(
      dir,
      "dealstream",
      join(dir, "ingest-failures", "dealstream.json"),
    );
    expect(Object.keys(other.failures)).toHaveLength(0);
  });
});
