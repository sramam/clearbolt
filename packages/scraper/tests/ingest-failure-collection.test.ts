import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearIngestFailure,
  defaultIngestFailuresPath,
  orderListingRefsForIngest,
  prioritizeFailedListingRefs,
  readIngestFailuresCollection,
  recordIngestFailure,
} from "../src/ingest-failure-collection.js";

describe("ingest failure collection", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("uses per-adapter failure file paths", () => {
    const root = "/data";
    expect(defaultIngestFailuresPath(root, "bizbuysell")).toBe(
      "/data/ingest-failures/bizbuysell.json",
    );
    expect(defaultIngestFailuresPath(root, "dealstream")).toBe(
      "/data/ingest-failures/dealstream.json",
    );
    expect(defaultIngestFailuresPath(root, "bizbuysell")).not.toBe(
      defaultIngestFailuresPath(root, "dealstream"),
    );
  });

  it("records and clears failures by external id", async () => {
    dir = await mkdtemp(join(tmpdir(), "cb-fail-"));
    const path = join(dir, "ingest-failures", "bizbuysell.json");
    const ref = {
      url: "https://www.bizbuysell.com/business-opportunity/x/123/",
      externalId: "123",
    };
    await recordIngestFailure(path, ref, "bizbuysell", new Error("timeout"));
    let col = await readIngestFailuresCollection(path);
    expect(col.failures["123"]?.attempts).toBe(1);
    await recordIngestFailure(path, ref, "bizbuysell", new Error("timeout"));
    col = await readIngestFailuresCollection(path);
    expect(col.failures["123"]?.attempts).toBe(2);
    await clearIngestFailure(path, "123");
    col = await readIngestFailuresCollection(path);
    expect(col.failures["123"]).toBeUndefined();
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.failures).toEqual({});
  });

  it("prioritizes failed refs without duplicates", () => {
    const refs = [
      { url: "https://example.com/a/1/", externalId: "1" },
      { url: "https://example.com/b/2/", externalId: "2" },
      { url: "https://example.com/c/3/", externalId: "3" },
    ];
    const ordered = prioritizeFailedListingRefs(refs, {
      version: 1,
      updatedAt: new Date().toISOString(),
      failures: {
        "3": {
          adapter: "bizbuysell",
          externalId: "3",
          url: refs[2]!.url,
          message: "waf",
          at: new Date().toISOString(),
          attempts: 1,
        },
      },
    });
    expect(ordered.map((r) => r.externalId)).toEqual(["3", "1", "2"]);
  });

  it("defers hard-block failures on normal resume", () => {
    const refs = [
      { url: "https://example.com/a/1/", externalId: "1" },
      { url: "https://example.com/b/2/", externalId: "2" },
    ];
    const collection = {
      version: 1 as const,
      updatedAt: new Date().toISOString(),
      failures: {
        "2": {
          adapter: "bizbuysell",
          externalId: "2",
          url: refs[1]!.url,
          message: "Akamai hard block (not retriable on this session)",
          at: new Date().toISOString(),
          attempts: 2,
        },
      },
    };
    expect(
      orderListingRefsForIngest(refs, collection).map((r) => r.externalId),
    ).toEqual(["1"]);
    expect(
      orderListingRefsForIngest(refs, collection, {
        prioritizeFailures: true,
      }).map((r) => r.externalId),
    ).toEqual(["1", "2"]);
  });
});
