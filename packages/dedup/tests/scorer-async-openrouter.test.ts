import type { SourceRecord } from "@clearbolt/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scorePair, scorePairAsync } from "../src/scorer.js";

const baseRecord = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  id: "id-1",
  adapter: "bizbuysell",
  url: "https://www.bizbuysell.com/california-business-for-sale/111/",
  externalId: "111",
  canonicalDealId: null,
  evidenceRef: {
    bucket: "disk",
    key: "k",
    sha256: "a".repeat(64),
    contentType: "text/html",
    sizeBytes: 1,
  },
  parsedFields: {
    title: "Joe's Pizza North",
    askingPrice: 500_000,
    state: "CA",
  },
  firstSeenAt: "2020-01-01T00:00:00.000Z",
  lastSeenAt: "2020-01-01T00:00:00.000Z",
  ...over,
});

describe("scorePairAsync (optional OpenRouter)", () => {
  const origKey = process.env.OPENROUTER_API_KEY;
  const origWeight = process.env.CLEARBOLT_DEDUP_LLM_WEIGHT;
  const origModel = process.env.CLEARBOLT_DEDUP_LLM_MODEL;

  afterEach(() => {
    if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey;
    else process.env.OPENROUTER_API_KEY = undefined;
    if (origWeight !== undefined)
      process.env.CLEARBOLT_DEDUP_LLM_WEIGHT = origWeight;
    else process.env.CLEARBOLT_DEDUP_LLM_WEIGHT = undefined;
    if (origModel !== undefined)
      process.env.CLEARBOLT_DEDUP_LLM_MODEL = origModel;
    else process.env.CLEARBOLT_DEDUP_LLM_MODEL = undefined;
    vi.unstubAllGlobals();
  });

  it("matches scorePair when OPENROUTER_API_KEY is unset", async () => {
    process.env.OPENROUTER_API_KEY = undefined;
    const a = baseRecord({ id: "a" });
    const b = baseRecord({
      id: "b",
      url: "https://www.bizbuysell.com/nevada-business-for-sale/222/",
      externalId: "222",
      parsedFields: { title: "Different Biz", state: "NV" },
    });
    await expect(scorePairAsync(a, b)).resolves.toEqual(scorePair(a, b));
  });

  it("blends LLM p_same when OpenRouter returns JSON", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.CLEARBOLT_DEDUP_LLM_WEIGHT = "0.5";
    process.env.CLEARBOLT_DEDUP_LLM_MODEL = "test/fake-model";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"p_same": 1}' } }],
        }),
      })),
    );

    const a = baseRecord({ id: "a" });
    const b = baseRecord({
      id: "b",
      url: "https://www.bizbuysell.com/nevada-business-for-sale/222/",
      externalId: "222",
      parsedFields: {
        title: "Joe's Pizza North Reno",
        askingPrice: 510_000,
        state: "NV",
      },
    });

    const sync = scorePair(a, b);
    const asyncR = await scorePairAsync(a, b);
    expect(asyncR.breakdown.llm).toBe(1);
    expect(asyncR.overall).toBeGreaterThan(sync.overall);
  });
});
