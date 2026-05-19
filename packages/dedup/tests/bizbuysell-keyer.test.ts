import { describe, expect, it } from "vitest";
import type { SourceRecord } from "@clearbolt/core";
import { BizBuySellDedupKeyer } from "../src/keyer.js";

describe("BizBuySellDedupKeyer", () => {
  it("emits listing number (external) key before URL", () => {
    const record = {
      id: "s1",
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/business-opportunity/foo/1234567/",
      externalId: "1234567",
      canonicalDealId: null,
      observedAt: new Date().toISOString(),
    } satisfies SourceRecord;
    const keys = new BizBuySellDedupKeyer().keys(record);
    expect(keys[0]).toEqual({
      kind: "external",
      adapter: "bizbuysell",
      externalId: "1234567",
    });
    expect(keys[1]?.kind).toBe("url");
  });
});
