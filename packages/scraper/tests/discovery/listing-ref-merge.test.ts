import { describe, expect, it } from "vitest";
import { mergeListingRefByExternalId } from "../../src/discovery/listing-ref-merge.js";
import {
  isBizBuySellListingUrl,
  listingRefFromBizBuySellUrl,
} from "../../src/bizbuysell-listing-url.js";

describe("listing-ref-merge", () => {
  it("merges www and mobile URLs for the same listing id", () => {
    const merged = new Map<string, { url: string; externalId?: string }>();
    mergeListingRefByExternalId(merged, {
      url: "https://m.bizbuysell.com/business-opportunity/foo/1234567/",
      externalId: "1234567",
    });
    mergeListingRefByExternalId(merged, {
      url: "https://www.bizbuysell.com/business-opportunity/foo/1234567/",
      externalId: "1234567",
    });
    expect(merged.size).toBe(1);
    const ref = [...merged.values()][0];
    expect(ref?.externalId).toBe("1234567");
    expect(ref?.url).toContain("www.bizbuysell.com");
  });

  it("excludes broker and auction paths from listing URLs", () => {
    expect(
      isBizBuySellListingUrl(
        "https://www.bizbuysell.com/business-broker/some-broker/1234567/",
      ),
    ).toBe(false);
    expect(
      isBizBuySellListingUrl(
        "https://www.bizbuysell.com/business-auction/lot/1234567/",
      ),
    ).toBe(false);
    expect(
      listingRefFromBizBuySellUrl(
        "https://www.bizbuysell.com/business-opportunity/pool/2507133/",
      ),
    ).toEqual({
      url: "https://www.bizbuysell.com/business-opportunity/pool/2507133/",
      externalId: "2507133",
    });
  });
});
