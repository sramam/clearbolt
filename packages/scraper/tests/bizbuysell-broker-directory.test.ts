import { describe, expect, it } from "vitest";
import {
  BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL,
  brokerDirectoryPageNumberFromPathname,
  buildBrokerDirectoryPageUrl,
  discoverBrokerRefsFromBizBuySellDirectoryPage,
  discoverNextBizBuySellBrokerDirectoryPageUrl,
  isBizBuySellBrokerDirectoryUrl,
} from "../src/adapters/bizbuysell/broker-directory.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("bizbuysell broker directory", () => {
  it("recognizes california broker directory URL", () => {
    expect(isBizBuySellBrokerDirectoryUrl(BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL)).toBe(
      true,
    );
    expect(
      isBizBuySellBrokerDirectoryUrl(
        "https://www.bizbuysell.com/business-broker/foo/bar/123/",
      ),
    ).toBe(false);
    expect(
      isBizBuySellBrokerDirectoryUrl(
        "https://www.bizbuysell.com/california-businesses-for-sale/",
      ),
    ).toBe(false);
  });

  it("builds paginated directory URLs", () => {
    const base = new URL(BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL);
    expect(buildBrokerDirectoryPageUrl(base, 2)).toBe(
      "https://www.bizbuysell.com/business-brokers/california/2/",
    );
    expect(brokerDirectoryPageNumberFromPathname("/business-brokers/california/3/")).toBe(
      3,
    );
  });

  it("discovers broker profile refs from directory HTML", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizbuysell-broker-directory-snippet.html"),
      "utf8",
    );
    const refs = discoverBrokerRefsFromBizBuySellDirectoryPage(
      html,
      BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL,
    );
    expect(refs).toHaveLength(2);
    expect(refs[0]?.externalBrokerId).toBe("10001");
    expect(refs[0]?.profileUrl).toContain("/business-broker/jane-smith/");
    expect(refs[1]?.externalBrokerId).toBe("10002");
  });

  it("synthesizes next page when broker links present", () => {
    const html = `<a href="/business-broker/a/b/1/">x</a>`;
    const next = discoverNextBizBuySellBrokerDirectoryPageUrl(
      html,
      BIZBUYSELL_CALIFORNIA_BROKER_DIRECTORY_URL,
    );
    expect(next).toContain("/business-brokers/california/2/");
  });
});
