import { describe, expect, it } from "vitest";
import { scrapeAdapterFromUrl } from "../src/scrape-adapter-from-url.js";

describe("scrapeAdapterFromUrl", () => {
  it("resolves bizquest search URLs", () => {
    expect(
      scrapeAdapterFromUrl(
        "https://www.bizquest.com/businesses-for-sale-in-midwest-region/",
      ),
    ).toBe("bizquest");
  });

  it("resolves bizbuysell catalog URLs", () => {
    expect(
      scrapeAdapterFromUrl(
        "https://www.bizbuysell.com/california-businesses-for-sale/",
      ),
    ).toBe("bizbuysell");
  });
});
