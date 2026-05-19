import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBizBuySellBrokerProfilePage } from "../src/adapters/bizbuysell-broker-parse.js";
import {
  isBizBuySellBrokerProfileUrl,
  listingIdFromSoldBusinessUrl,
} from "../src/bizbuysell-broker-url.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("bizbuysell broker", () => {
  it("recognizes broker profile URLs", () => {
    expect(
      isBizBuySellBrokerProfileUrl(
        "https://www.bizbuysell.com/business-broker/rebecca-carr/west-shores-realty/31464/",
      ),
    ).toBe(true);
    expect(
      isBizBuySellBrokerProfileUrl(
        "https://www.bizbuysell.com/business-brokers/directory/",
      ),
    ).toBe(false);
  });

  it("decodes sold-business listing ids", () => {
    const id = listingIdFromSoldBusinessUrl(
      "https://www.bizbuysell.com/sold-business/mexican-food-drive-through/MjQ4MzUyMw==/31464/",
    );
    expect(id).toBe("2483523");
  });

  it("parses sold listings from broker profile fixture", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizbuysell-broker-profile-snippet.html"),
      "utf8",
    );
    const profile = parseBizBuySellBrokerProfilePage(
      html,
      "https://www.bizbuysell.com/business-broker/rebecca-carr/west-shores-realty/31464/",
    );
    expect(profile.name).toBe("Rebecca Carr");
    expect(profile.firm).toBe("West Shores Realty");
    expect(profile.soldListingIds).toContain("2483523");
  });
});
