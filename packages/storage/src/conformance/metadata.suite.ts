import type {
  CanonicalDeal,
  DedupKey,
  DomainProfile,
  SourceRecord,
} from "@clearbolt/core";
import { expect } from "vitest";
import type { MetadataStore } from "../contracts.js";

/** Synthetic host for domain-profile checks — avoids clobbering real scrape domains on shared DBs. */
export const CONFORMANCE_DOMAIN_HOST = "conformance-fixture.example";

/** Shared MetadataStore contract checks (disk, Neon, …). */
export async function assertMetadataStoreConformance(
  store: MetadataStore,
): Promise<void> {
  const sr: SourceRecord = {
    id: "s1",
    adapter: "bizbuysell",
    url: "https://www.bizbuysell.com/x",
    externalId: "123",
    canonicalDealId: null,
    evidenceRef: {
      bucket: "disk",
      key: "raw/bizbuysell/abc.html",
      sha256: "a".repeat(64),
      contentType: "text/html",
      sizeBytes: 3,
    },
    parsedFields: { title: "Test Co" },
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await store.putSource(sr);
  const got = await store.getSource("s1");
  expect(got?.id).toBe("s1");

  const deal: CanonicalDeal = {
    id: "c1",
    sourceIds: ["s1"],
    representativeSourceId: "s1",
  };
  await store.putCanonical(deal);
  expect((await store.getCanonical("c1"))?.id).toBe("c1");
  expect(await store.listCanonicalIds()).toContain("c1");

  const key: DedupKey = {
    kind: "external",
    adapter: "bizbuysell",
    externalId: "123",
  };
  await store.setDedupMapping(key, "c1");
  expect(await store.getCanonicalIdForDedupKey(key)).toBe("c1");

  const profile: DomainProfile = {
    host: CONFORMANCE_DOMAIN_HOST,
    needsBrowser: true,
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
  await store.putDomainProfile(profile);
  expect(await store.getDomainProfile(CONFORMANCE_DOMAIN_HOST)).toEqual(
    profile,
  );

  const base = {
    adapter: "bizbuysell",
    url: "https://example.com/a",
    canonicalDealId: null,
    evidenceRef: {
      bucket: "disk",
      key: "raw/x",
      sha256: "b".repeat(64),
      contentType: "text/html",
      sizeBytes: 1,
    },
    parsedFields: {},
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await store.putSource({ ...base, id: "s-a", url: "https://a" });
  await store.putSource({ ...base, id: "s-b", url: "https://b" });
  const sourceIds = await store.listSourceIds();
  for (const id of ["s-a", "s-b", "s1"] as const) {
    expect(sourceIds).toContain(id);
  }
}
