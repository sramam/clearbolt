import { afterEach, describe, expect, it } from "vitest";
import { shouldBlockBrowserRequest } from "../src/browser-resource-block.js";

describe("browser resource blocking", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("blocks google ads and gstatic", () => {
    process.env.CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY = "1";
    expect(
      shouldBlockBrowserRequest(
        "https://www.googletagmanager.com/gtm.js",
        "script",
      ),
    ).toBe(true);
    expect(
      shouldBlockBrowserRequest("https://fonts.gstatic.com/s.woff2", "font"),
    ).toBe(true);
  });

  it("allows bizbuysell document and script but blocks images", () => {
    process.env.CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY = "1";
    expect(
      shouldBlockBrowserRequest(
        "https://www.bizbuysell.com/business-opportunity/x/1/",
        "document",
      ),
    ).toBe(false);
    expect(
      shouldBlockBrowserRequest(
        "https://m.bizbuysell.com/main.js",
        "script",
      ),
    ).toBe(false);
    expect(
      shouldBlockBrowserRequest(
        "https://images.bizbuysell.com/listing/photo.jpg",
        "image",
      ),
    ).toBe(true);
  });

  it("allows dealstream and datadome challenge scripts", () => {
    process.env.CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY = "1";
    expect(
      shouldBlockBrowserRequest("https://dealstream.com/assets/app.js", "script"),
    ).toBe(false);
    expect(
      shouldBlockBrowserRequest(
        "https://ct.captcha-delivery.com/i.js",
        "script",
      ),
    ).toBe(false);
  });

  it("allows geo.captcha-delivery stylesheets and fonts (DataDome interstitial)", () => {
    process.env.CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY = "1";
    expect(
      shouldBlockBrowserRequest(
        "https://geo.captcha-delivery.com/assets/font-face.css",
        "stylesheet",
      ),
    ).toBe(false);
    expect(
      shouldBlockBrowserRequest(
        "https://geo.captcha-delivery.com/assets/index.css",
        "stylesheet",
      ),
    ).toBe(false);
    expect(
      shouldBlockBrowserRequest(
        "https://geo.captcha-delivery.com/assets/logo.png",
        "image",
      ),
    ).toBe(false);
  });

  it("can disable blocking", () => {
    process.env.CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY = "0";
    expect(
      shouldBlockBrowserRequest("https://www.google.com/gen_204", "xhr"),
    ).toBe(false);
  });
});
