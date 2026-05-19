import { describe, expect, it } from "vitest";
import {
  listingHasLlmEnrichGaps,
  mergeListingLlmPatch,
} from "../src/adapters/bizbuysell-listing-llm-enrich.js";
import type { BizBuySellListingExtract } from "../src/adapters/bizbuysell-listing-parse.js";
import { ListingLlmEnrichPatchSchema } from "../src/listing-llm-enrich-schema.js";

function baseExtract(): BizBuySellListingExtract {
  return { title: "Test Co" };
}

describe("listing LLM enrich", () => {
  it("detects gaps for category, employees, and ambiguous inventory/ffe", () => {
    expect(listingHasLlmEnrichGaps(baseExtract())).toBe(true);
    expect(
      listingHasLlmEnrichGaps({
        categories: ["CA", "Retail"],
        numberOfEmployees: "5",
        industry: "Retail",
      }),
    ).toBe(false);
    expect(
      listingHasLlmEnrichGaps({
        inventory: "$50,000",
        inventoryIncludedInAskingPrice: true,
        ffe: "$125,000 | Included in asking price",
        ffeIncludedInAskingPrice: true,
        categories: ["CA"],
        numberOfEmployees: "3",
        industry: "Retail",
      }),
    ).toBe(false);
    expect(
      listingHasLlmEnrichGaps({
        inventory: "$50,000",
        categories: ["CA"],
        numberOfEmployees: "3",
        industry: "Retail",
      }),
    ).toBe(true);
  });

  it("merges patch into blanks only by default", () => {
    const extract: BizBuySellListingExtract = {
      title: "Stone shop",
      inventory: "$20,000",
      numberOfEmployees: "8 Full-time",
    };
    mergeListingLlmPatch(extract, {
      category: "Manufacturing",
      categories: ["California", "Manufacturing", "Stone"],
      finalCategory: "Stone",
      industry: "Stone fabrication",
      numberOfEmployees: "99",
      inventoryIncludedInAskingPrice: true,
      ffeIncludedInAskingPrice: false,
      confidence: "high",
    });
    expect(extract.category).toBe("Manufacturing");
    expect(extract.categories).toEqual([
      "California",
      "Manufacturing",
      "Stone",
    ]);
    expect(extract.finalCategory).toBe("Stone");
    expect(extract.industry).toBe("Stone fabrication");
    expect(extract.numberOfEmployees).toBe("8 Full-time");
    expect(extract.inventoryIncludedInAskingPrice).toBe(true);
    expect(extract.ffeIncludedInAskingPrice).toBe(false);
  });

  it("validates LLM patch schema", () => {
    const ok = ListingLlmEnrichPatchSchema.safeParse({
      categories: ["A", "B"],
      inventoryIncludedInAskingPrice: true,
      confidence: "medium",
    });
    expect(ok.success).toBe(true);
  });
});
