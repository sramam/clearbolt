import type { SourceRecord } from "@clearbolt/core";
import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  scorePair,
  scorePairBodyEmbedding,
} from "../src/scorer.js";

const ev = {
  bucket: "disk",
  key: "k",
  sha256: "a".repeat(64),
  contentType: "text/html",
  sizeBytes: 1,
} as const;

function rec(
  id: string,
  over: Partial<SourceRecord> & {
    bodyEmbedding?: number[];
    parsedFields?: SourceRecord["parsedFields"];
  } = {},
): SourceRecord {
  const { bodyEmbedding, parsedFields, ...rest } = over;
  return {
    id,
    adapter: "bizbuysell",
    url: `https://example.com/${id}`,
    canonicalDealId: null,
    evidenceRef: ev,
    parsedFields: { title: "T", state: "CA", ...parsedFields },
    firstSeenAt: "2020-01-01T00:00:00.000Z",
    lastSeenAt: "2020-01-01T00:00:00.000Z",
    bodyEmbedding,
    ...rest,
  };
}

describe("scorePairBodyEmbedding", () => {
  it("cosine 1 maps embedding score toward 1", () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    expect(
      scorePairBodyEmbedding(
        rec("a", { bodyEmbedding: v }),
        rec("b", { bodyEmbedding: v }),
      ),
    ).toBeCloseTo(1, 5);
  });

  it("scorePair adds embedding breakdown when both sides have same-dim vectors", () => {
    const a = rec("a", { bodyEmbedding: [1, 0, 0] });
    const b = rec("b", { bodyEmbedding: [1, 0, 0] });
    const r = scorePair(a, b);
    expect(r.breakdown.embedding).toBeCloseTo(1, 5);
    expect(r.overall).toBeGreaterThan(0.5);
  });

  it("orthogonal vectors yield mid-range embedding score", () => {
    const a = rec("a", { bodyEmbedding: [1, 0, 0] });
    const b = rec("b", { bodyEmbedding: [0, 1, 0] });
    const emb = scorePairBodyEmbedding(a, b);
    expect(emb).toBeCloseTo(0.5, 5);
  });
});
