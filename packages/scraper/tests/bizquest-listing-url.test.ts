import { describe, expect, it } from "vitest";
import {
  extractBizQuestListingIdFromPathname,
  isBizQuestListingUrl,
  listingRefFromBizQuestUrl,
} from "../src/bizquest-listing-url.js";

describe("bizquest listing url", () => {
  it("extracts BW listing id from pathname", () => {
    expect(
      extractBizQuestListingIdFromPathname(
        "/business-for-sale/pizza-franchise/BW2486214/",
      ),
    ).toBe("BW2486214");
  });

  it("builds listing ref", () => {
    const ref = listingRefFromBizQuestUrl(
      "https://www.bizquest.com/business-for-sale/pizza-franchise/BW2486214/",
    );
    expect(ref?.externalId).toBe("BW2486214");
    expect(isBizQuestListingUrl(ref!.url)).toBe(true);
  });
});
