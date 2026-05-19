import { describe, expect, it } from "vitest";
import { BrokerSiteDedupKeyer } from "../src/keyer.js";

describe("BrokerSiteDedupKeyer", () => {
  it("keys by broker-site external id and url", () => {
    const keys = new BrokerSiteDedupKeyer().keys({
      id: "x",
      adapter: "broker-site",
      url: "https://acme.com/business/foo-bar/",
      externalId: "foo-bar",
      canonicalDealId: null,
      evidenceRef: {
        bucket: "b",
        key: "k",
        sha256: "s",
        contentType: "text/html",
        sizeBytes: 1,
      },
      parsedFields: {},
    });
    expect(keys[0]?.kind).toBe("url");
    expect(
      keys.some((k) => k.kind === "external" && k.adapter === "broker-site"),
    ).toBe(true);
  });
});
