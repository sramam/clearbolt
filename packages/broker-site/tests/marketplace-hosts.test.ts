import { describe, expect, it } from "vitest";
import { isMarketplaceHost, isMarketplaceUrl } from "../src/marketplace-hosts.js";

describe("marketplace hosts", () => {
  it("blocks bizbuysell", () => {
    expect(isMarketplaceHost("www.bizbuysell.com")).toBe(true);
    expect(isMarketplaceUrl("https://www.bizbuysell.com/foo")).toBe(true);
  });

  it("allows independent broker domains", () => {
    expect(isMarketplaceHost("www.acmebusinessbrokers.com")).toBe(false);
    expect(isMarketplaceUrl("https://www.acmebusinessbrokers.com/listings/1")).toBe(
      false,
    );
  });
});
