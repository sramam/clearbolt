import { describe, expect, it } from "vitest";
import { catalogPageFetchTargets } from "../src/bizbuysell-catalog-scrape-pipeline.js";
import { isTransientNetworkError } from "../src/network-errors.js";

describe("network-errors", () => {
  it("detects undici connect timeout", () => {
    const err = new TypeError("fetch failed", {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
    expect(isTransientNetworkError(err)).toBe(true);
  });
});

describe("catalogPageFetchTargets", () => {
  it("does not fall back mobile to www", () => {
    const mobile = "https://m.bizbuysell.com/california-businesses-for-sale/";
    expect(catalogPageFetchTargets(mobile)).toEqual([mobile]);
  });

  it("adds mobile fallback when primary is www", () => {
    const www = "https://www.bizbuysell.com/california-businesses-for-sale/";
    expect(catalogPageFetchTargets(www)).toEqual([
      www,
      "https://m.bizbuysell.com/california-businesses-for-sale/",
    ]);
  });
});
