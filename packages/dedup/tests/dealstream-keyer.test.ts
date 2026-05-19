import { describe, expect, it } from "vitest";
import { DealStreamDedupKeyer } from "../src/keyer.js";

describe("DealStreamDedupKeyer", () => {
  it("prefers external id before url", () => {
    const record = {
      id: "r1",
      adapter: "dealstream",
      url: "https://dealstream.com/d/biz-sale/hvac/9m25ky",
      externalId: "9m25ky",
      canonicalDealId: null,
      evidenceRef: { key: "k", sha256: "s" },
      parsedFields: {},
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    };
    const keys = new DealStreamDedupKeyer().keys(record);
    expect(keys[0]).toEqual({
      kind: "external",
      adapter: "dealstream",
      externalId: "9m25ky",
    });
    expect(keys[1]?.kind).toBe("url");
  });
});
