import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDealStreamBrokerProfilePage } from "../src/adapters/dealstream-broker-parse.js";
import { parseDealStreamListingPage } from "../src/adapters/dealstream-listing-parse.js";
import { isDealStreamBrokerProfileUrl } from "../src/dealstream-broker-url.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("dealstream listing parse", () => {
  it("parses financials and broker profile from fixture", async () => {
    const html = await readFile(
      join(fixturesDir, "dealstream-listing-hvac-9m25ky.html"),
      "utf8",
    );
    const url = "https://dealstream.com/d/biz-sale/hvac/9m25ky";
    const p = parseDealStreamListingPage(html, url);

    expect(p.externalId).toBe("9m25ky");
    expect(p.title).toMatch(/HVAC/i);
    expect(p.askingPrice).toBe(950_000);
    expect(p.cashFlow).toBe(403_927);
    expect(p.revenue).toBe(1_307_780);
    expect(p.representedByBroker).toBe(true);
    expect(p.brokerProfileUrl).toContain("/d/biz-broker/");
    expect(p.brokerName).toBe("Acme Advisors");
    expect(p.listingId).toBe("52650");
  });

  it("parses active listings from broker profile fixture", async () => {
    const html = await readFile(
      join(fixturesDir, "dealstream-broker-profile-snippet.html"),
      "utf8",
    );
    const url =
      "https://dealstream.com/d/biz-broker/acme-advisors/west-region/abc12";
    expect(isDealStreamBrokerProfileUrl(url)).toBe(true);
    const profile = parseDealStreamBrokerProfilePage(html, url);
    expect(profile.activeListings).toHaveLength(2);
    expect(profile.activeListings.map((c) => c.externalId).sort()).toEqual([
      "5ate8e",
      "9m25ky",
    ]);
  });
});
