import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBizBuySellListingPage } from "../src/adapters/bizbuysell-listing-parse.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("parseBizBuySellListingPage", () => {
  it("parses financials and geo from sample listing HTML", async () => {
    const html = await readFile(join(repoRoot, "sample.html"), "utf8");
    const url =
      "https://www.bizbuysell.com/business-opportunity/los-angeles-established-security-services-business-backed-by-signal/2506888/";
    const p = parseBizBuySellListingPage(html, url);

    expect(p.externalId).toBe("2506888");
    expect(p.title).toMatch(/Security Services/i);
    expect(p.revenue).toBe(737_000);
    expect(p.ebitda).toBe(113_000);
    expect(p.yearEstablished).toBe(2024);
    expect(p.location).toBe("Los Angeles, CA");
    expect(p.city).toBe("Los Angeles");
    expect(p.state).toBe("CA");
    expect(p.categories).toContain("California");
    expect(p.finalCategory).toBe("Los Angeles");
    expect(p.intermediaryName).toMatch(/Tim Munderloh/i);
    expect(p.intermediaryPhone).toMatch(/402/);
    expect(p.financing).toMatch(/Seller financing/i);
    expect(p.homeBased).toMatch(/Home-Based/i);
    expect(p.geo?.h3IndexRes7).toMatch(/^[0-9a-f]+$/i);
    expect(p.geo?.h3IndexRes5).toMatch(/^[0-9a-f]+$/i);
  });

  it("extracts broker phone from click-to-reveal hidden tel link", async () => {
    const html = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "bizbuysell-listing-hidden-phone-snippet.html",
      ),
      "utf8",
    );
    const p = parseBizBuySellListingPage(
      html,
      "https://www.bizbuysell.com/business-opportunity/sample/9999001/",
    );
    expect(p.intermediaryName).toBe("Jane Broker");
    expect(p.intermediaryPhone).toBe("408-555-0199");
  });

  it("parses detailed information, location, and broker block", async () => {
    const html = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "bizbuysell-listing-details-snippet.html",
      ),
      "utf8",
    );
    const p = parseBizBuySellListingPage(
      html,
      "https://www.bizbuysell.com/business-opportunity/mexican-food-drive-through-restaurant-for-sale/2483523/",
    );
    expect(p.inventoryValue).toBe(10_000_000);
    expect(p.inventoryIncludedInAskingPrice).toBe(true);
    expect(p.ffeIncludedInAskingPrice).toBe(true);
    expect(p.numberOfEmployees).toMatch(/10 Full-time/);
    expect(p.location).toBe("City of Industry, CA");
    expect(p.realEstate).toBe("Leased");
    expect(p.buildingSf).toBe("160,000");
    expect(p.rentAmount).toBe(224_000);
    expect(p.intermediaryEmail).toBe("rebecca@westshores.example");
    expect(p.brokerProfileUrl).toContain("/business-broker/rebecca-carr/");
    expect(p.brokerageNote).toMatch(/Full-service brokerage/);
  });

  it("parses minimal fixture", async () => {
    const html = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "bizbuysell-listing-1234567.html",
      ),
      "utf8",
    );
    const p = parseBizBuySellListingPage(
      html,
      "https://www.bizbuysell.com/california-business-for-sale/1234567/",
    );
    expect(p.askingPrice).toBe(450_000);
    expect(p.title).toContain("Acme");
  });
});
