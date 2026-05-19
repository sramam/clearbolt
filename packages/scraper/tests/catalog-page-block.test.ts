import { describe, expect, it } from "vitest";
import { detectCatalogPageBlock } from "../src/catalog-page-block.js";

const DATADOME_HTML = `<html><body><p>Please enable JS and disable any ad blocker</p>
<script src="https://ct.captcha-delivery.com/i.js"></script></body></html>`;

const DATADOME_RESTRICTED_HTML = `<html><body>
<h1>Access is temporarily restricted</h1>
<p>We detected unusual activity from your device or network.</p>
<p>Automated (bot) activity on your network (IP 96.235.142.156)</p>
</body></html>`;

describe("detectCatalogPageBlock", () => {
  it("detects DataDome challenge pages", () => {
    const block = detectCatalogPageBlock(403, DATADOME_HTML);
    expect(block?.reason).toBe("datadome_challenge");
  });

  it("detects DataDome access-restricted interstitial", () => {
    const block = detectCatalogPageBlock(200, DATADOME_RESTRICTED_HTML);
    expect(block?.reason).toBe("datadome_challenge");
    expect(block?.message).toContain("temporarily restricted");
  });

  it("does not flag a normal empty catalog body", () => {
    const html =
      "<html><body><main><p>No listings match your filters.</p></main></body></html>";
    expect(detectCatalogPageBlock(200, html)).toBeNull();
  });
});
