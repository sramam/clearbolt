import { describe, expect, it } from "vitest";
import { BusinessBrokerDedupKeyer } from "../src/keyer.js";

describe("BusinessBrokerDedupKeyer", () => {
  it("keys by external id and url", () => {
    const keys = new BusinessBrokerDedupKeyer().keys({
      id: "r1",
      adapter: "businessbroker",
      url: "https://www.businessbroker.net/business-for-sale/foo/1010506.aspx",
      externalId: "1010506",
      canonicalDealId: null,
      evidenceRef: {
        bucket: "b",
        key: "k",
        sha256: "s",
        contentType: "text/html",
        sizeBytes: 1,
      },
      parsedFields: {},
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    expect(keys).toContainEqual({
      kind: "external",
      adapter: "businessbroker",
      externalId: "1010506",
    });
    expect(keys.some((k) => k.kind === "url")).toBe(true);
  });
});
