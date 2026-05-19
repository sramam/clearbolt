import { describe, expect, it } from "vitest";
import type { SourceRecord } from "@clearbolt/core";
import { BizQuestDedupKeyer } from "../src/keyer.js";

describe("BizQuestDedupKeyer", () => {
  it("emits BW external id before URL", () => {
    const record = {
      id: "s1",
      adapter: "bizquest",
      url: "https://www.bizquest.com/business-for-sale/foo/BW2486214/",
      externalId: "BW2486214",
      canonicalDealId: null,
      observedAt: new Date().toISOString(),
    } satisfies SourceRecord;
    const keys = new BizQuestDedupKeyer().keys(record);
    expect(keys[0]).toEqual({
      kind: "external",
      adapter: "bizquest",
      externalId: "BW2486214",
    });
    expect(keys[1]?.kind).toBe("url");
  });
});
