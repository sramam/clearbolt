import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bizBuySellListingFetchUrl } from "../src/adapters/bizbuysell.js";

describe("bizBuySellListingFetchUrl", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("rewrites www to m. when browser-first and proxy endpoints file", () => {
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = "1";
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = "proxy-endpoints.local.txt";
    expect(
      bizBuySellListingFetchUrl(
        "https://www.bizbuysell.com/business-opportunity/foo/1234567/",
      ),
    ).toBe("https://m.bizbuysell.com/business-opportunity/foo/1234567/");
  });

  it("leaves URL unchanged without proxy/browser-first", () => {
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = undefined;
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = undefined;
    process.env.CLEARBOLT_PROXY_RESIDENTIAL = undefined;
    const url = "https://www.bizbuysell.com/business-opportunity/foo/1234567/";
    expect(bizBuySellListingFetchUrl(url)).toBe(url);
  });

  it("uses www when LISTING_PREFER_MOBILE=0 even with proxy", () => {
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = "1";
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = "proxy-endpoints.local.txt";
    process.env.CLEARBOLT_BIZBUYSELL_LISTING_PREFER_MOBILE = "0";
    const url = "https://www.bizbuysell.com/business-opportunity/foo/1234567/";
    expect(bizBuySellListingFetchUrl(url)).toBe(url);
  });
});
