import type { SourceRecord } from "@clearbolt/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearDedupEmbedModelCacheForTests,
  clearFreeDedupModelCacheForTests,
  llmDedupSimilarityOpenRouter,
  resolveDedupEmbedOpenRouterModel,
  resolveFreeDedupOpenRouterModel,
  scorePairAsync,
} from "../src/index.js";

const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());

function baseRecord(over: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: "live-a",
    adapter: "bizbuysell",
    url: "https://www.bizbuysell.com/california-business-for-sale/9000001/",
    externalId: "9000001",
    canonicalDealId: null,
    evidenceRef: {
      bucket: "disk",
      key: "k",
      sha256: "b".repeat(64),
      contentType: "text/html",
      sizeBytes: 1,
    },
    parsedFields: {
      title: "Acme Widget Co — Los Angeles",
      askingPrice: 1_200_000,
      state: "CA",
      city: "Los Angeles",
    },
    firstSeenAt: "2024-01-01T00:00:00.000Z",
    lastSeenAt: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Skipped locally without a key; CI requires the key via scripts/verify-openrouter-ci-secret.mjs before `pnpm test`. */
describe.skipIf(!hasOpenRouterKey)("OpenRouter dedup (live network)", () => {
  beforeAll(() => {
    clearFreeDedupModelCacheForTests();
    clearDedupEmbedModelCacheForTests();
  });

  afterAll(() => {
    clearFreeDedupModelCacheForTests();
    clearDedupEmbedModelCacheForTests();
  });

  it(
    "resolveFreeDedupOpenRouterModel returns a catalog id",
    { timeout: 45_000 },
    async () => {
      const id = await resolveFreeDedupOpenRouterModel();
      expect(id).toMatch(/^[a-zA-Z0-9./:_-]+$/);
      expect(id).toContain("/");
      expect(id.length).toBeGreaterThan(4);
    },
  );

  it(
    "resolveDedupEmbedOpenRouterModel returns a catalog id",
    { timeout: 45_000 },
    async () => {
      const id = await resolveDedupEmbedOpenRouterModel();
      expect(id).toMatch(/^[a-zA-Z0-9./:_-]+$/);
      expect(id).toContain("/");
      expect(id.length).toBeGreaterThan(4);
    },
  );

  it(
    "llmDedupSimilarityOpenRouter returns p_same in [0,1]",
    { timeout: 60_000, retry: 2 },
    async () => {
      const a = baseRecord({ id: "live-a" });
      const b = baseRecord({
        id: "live-b",
        url: "https://www.bizbuysell.com/nevada-business-for-sale/9000002/",
        externalId: "9000002",
        parsedFields: {
          title: "Unrelated Laundromat Reno",
          askingPrice: 80_000,
          state: "NV",
          city: "Reno",
        },
      });
      const llm = await llmDedupSimilarityOpenRouter(a, b);
      expect(llm).not.toBeNull();
      expect(llm).toBeGreaterThanOrEqual(0);
      expect(llm).toBeLessThanOrEqual(1);
    },
  );

  it(
    "scorePairAsync includes numeric llm breakdown when key is set",
    { timeout: 60_000, retry: 2 },
    async () => {
      const a = baseRecord({ id: "live-a2" });
      const b = baseRecord({
        id: "live-b2",
        url: "https://www.bizbuysell.com/nevada-business-for-sale/9000003/",
        externalId: "9000003",
        parsedFields: {
          title: "Different industry shop",
          askingPrice: 50_000,
          state: "NV",
        },
      });
      const r = await scorePairAsync(a, b);
      expect(typeof r.breakdown.llm).toBe("number");
      expect(r.breakdown.llm).toBeGreaterThanOrEqual(0);
      expect(r.breakdown.llm).toBeLessThanOrEqual(1);
      expect(r.overall).toBeGreaterThanOrEqual(0);
      expect(r.overall).toBeLessThanOrEqual(1);
    },
  );
});
