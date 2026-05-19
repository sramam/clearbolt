import { describe, expect, it } from "vitest";
import { buildBizBuySellSearchUrl } from "../src/bizbuysell-search-url.js";

describe("buildBizBuySellSearchUrl", () => {
  it("sets q from keywords", () => {
    const url = buildBizBuySellSearchUrl({ keywords: "pool services" });
    expect(url).toContain("bizbuysell.com");
    expect(url).toContain("q=pool+services");
  });

  it("includes geo when provided", () => {
    const url = buildBizBuySellSearchUrl({
      keywords: "manufacturing",
      geo: "california",
    });
    expect(url).toContain("geo=california");
    expect(url).toContain("q=manufacturing");
  });
});
