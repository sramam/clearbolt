import { describe, expect, it } from "vitest";
import {
  buildBizQuestSearchPageUrl,
  isBizQuestSearchUrl,
  parseBizQuestSearchUrl,
  serializeBizQuestSearchUrl,
} from "../src/bizquest-search-url.js";

describe("bizquest search url", () => {
  it("recognizes regional search URLs", () => {
    expect(
      isBizQuestSearchUrl(
        "https://www.bizquest.com/businesses-for-sale-in-midwest-region/",
      ),
    ).toBe(true);
    expect(
      isBizQuestSearchUrl(
        "https://www.bizquest.com/business-for-sale/foo/BW1/",
      ),
    ).toBe(false);
  });

  it("round-trips pagination", () => {
    const base =
      "https://www.bizquest.com/businesses-for-sale-in-midwest-region/";
    const page2 = buildBizQuestSearchPageUrl(base, 2);
    expect(page2).toContain("/page-2/");
    const parsed = parseBizQuestSearchUrl(page2);
    expect(parsed.page).toBe(2);
    expect(serializeBizQuestSearchUrl(parsed)).toBe(page2);
  });
});
