import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DiskListingIngestStateStore,
  buildListingIngestState,
  countIngestedInRefList,
  countListingIngestStatesOnDisk,
} from "../src/listing-ingest-state.js";

describe("DiskListingIngestStateStore", () => {
  it("writes and reads per-listing state.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "cb-ingest-state-"));
    const store = new DiskListingIngestStateStore(root);
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "1234567",
        url: "https://www.bizbuysell.com/x/1234567/",
        status: "failed",
        failure: { message: "timeout", at: new Date().toISOString() },
      }),
    );
    const state = await store.get("bizbuysell", "1234567");
    expect(state?.status).toBe("failed");
    const raw = await readFile(
      join(root, "listing-ingest-state", "bizbuysell", "1234567", "state.json"),
      "utf8",
    );
    expect(raw).toContain("timeout");
  });

  it("lists ingested dedupe keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "cb-ingest-state-"));
    const store = new DiskListingIngestStateStore(root);
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "1",
        url: "https://example.com/1",
        status: "ingested",
      }),
    );
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "2",
        url: "https://example.com/2",
        status: "failed",
      }),
    );
    const keys = await store.listIngestedDedupeKeys("bizbuysell");
    expect(keys).toEqual(new Set(["id:1"]));
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "3",
        url: "https://example.com/3",
        status: "skipped_known",
      }),
    );
    const withSkip = await store.listIngestedDedupeKeys("bizbuysell");
    expect(withSkip).toEqual(new Set(["id:1", "id:3"]));
  });

  it("countListingIngestStatesOnDisk tallies by status", async () => {
    const root = await mkdtemp(join(tmpdir(), "cb-ingest-state-"));
    const store = new DiskListingIngestStateStore(root);
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "1",
        url: "https://example.com/1",
        status: "ingested",
      }),
    );
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "2",
        url: "https://example.com/2",
        status: "failed",
      }),
    );
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "3",
        url: "https://example.com/3",
        status: "skipped_known",
      }),
    );
    const counts = await countListingIngestStatesOnDisk(root, "bizbuysell");
    expect(counts).toEqual({
      ingested: 1,
      failed: 1,
      skipped_known: 1,
      skipped_fresh: 0,
      total: 3,
    });
  });

  it("countIngestedInRefList matches ingested keys in a ref batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "cb-ingest-state-"));
    const store = new DiskListingIngestStateStore(root);
    await store.put(
      buildListingIngestState({
        adapter: "bizbuysell",
        externalId: "99",
        url: "https://www.bizbuysell.com/x/99/",
        status: "ingested",
      }),
    );
    const refs = [
      { url: "https://www.bizbuysell.com/x/99/", externalId: "99" },
      { url: "https://www.bizbuysell.com/x/100/", externalId: "100" },
    ];
    expect(await countIngestedInRefList(store, "bizbuysell", refs)).toBe(1);
  });
});
