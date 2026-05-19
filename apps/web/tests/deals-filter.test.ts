import { describe, expect, it } from "vitest";
import {
  buildDealSearchHaystack,
  filterDealsByQuery,
  matchesDealQuery,
  type DealListingDTO,
} from "../lib/deals";

const sample: DealListingDTO = {
  canonicalId: "c1",
  title: "Pool cleaning services — Los Angeles",
  location: "Los Angeles, CA",
  askingPrice: 500_000,
  sources: [
    {
      adapter: "bizbuysell",
      url: "https://www.bizbuysell.com/california-business-for-sale/1/",
      sourceRecordId: "s1",
    },
  ],
};

describe("matchesDealQuery", () => {
  it("matches when all tokens appear in haystack", () => {
    const hay = buildDealSearchHaystack(sample);
    expect(matchesDealQuery(hay, "pool services")).toBe(true);
    expect(matchesDealQuery(hay, "los angeles pool")).toBe(true);
  });

  it("rejects when a token is missing", () => {
    const hay = buildDealSearchHaystack(sample);
    expect(matchesDealQuery(hay, "pool manufacturing")).toBe(false);
  });

  it("empty query matches everything", () => {
    expect(matchesDealQuery("anything", "")).toBe(true);
  });
});

describe("filterDealsByQuery", () => {
  it("filters listings by tokens", () => {
    const out = filterDealsByQuery([sample], "pool");
    expect(out).toHaveLength(1);
    expect(filterDealsByQuery([sample], "manufacturing")).toHaveLength(0);
  });
});
