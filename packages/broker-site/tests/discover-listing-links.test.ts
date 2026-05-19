import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverListingLinksFromPage } from "../src/discover-listing-links.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("discoverListingLinksFromPage", () => {
  it("finds on-site listing links and ignores marketplace outbound", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "broker-site-index-snippet.html"),
      "utf8",
    );
    const links = discoverListingLinksFromPage(
      html,
      "https://www.acmebrokers.com/businesses-for-sale/",
    );
    expect(links.some((l) => l.url.includes("acmebrokers.com/business/"))).toBe(
      true,
    );
    expect(links.some((l) => l.url.includes("bizbuysell.com"))).toBe(false);
  });
});
