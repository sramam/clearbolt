import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBusinessBrokerListingPage } from "../src/adapters/businessbroker-listing-parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LISTING_URL =
  "https://www.businessbroker.net/business-for-sale/established-underground-construction-contractor-california/1010506.aspx";

describe("businessbroker listing parse", () => {
  it("extracts financials and broker contact from fixture", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "businessbroker-listing-1010506.html"),
      "utf8",
    );
    const parsed = parseBusinessBrokerListingPage(html, LISTING_URL);
    expect(parsed.externalId).toBe("1010506");
    expect(parsed.title).toContain("Underground Construction");
    expect(parsed.askingPrice).toBe(2_159_000);
    expect(parsed.revenue).toBe(3_335_068);
    expect(parsed.cashFlow).toBe(636_244);
    expect(parsed.brokerName).toBe("Lucas Benavides");
    expect(parsed.location).toMatch(/Not Disclosed|California/i);
    expect(parsed.description).toMatch(/Company Overview/i);
  });

  it("extracts broker from minimal contact block", () => {
    const html = `
      <h1>Sample Business</h1>
      <ul class="contact_seller_content">
        <li><strong>Contact:</strong> &nbsp;Jane Broker</li>
      </ul>
      <motion class="busListingQuickFacts">
        Asking Price: $500,000
        BBN Listing #: 42
      </motion>
    `
      .replace(/<motion/g, "<div")
      .replace(/<\/motion>/g, "</div>");
    const parsed = parseBusinessBrokerListingPage(
      html,
      "https://www.businessbroker.net/business-for-sale/sample/42.aspx",
    );
    expect(parsed.brokerName).toBe("Jane Broker");
    expect(parsed.askingPrice).toBe(500_000);
    expect(parsed.externalId).toBe("42");
  });
});
