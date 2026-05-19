import { describe, expect, it } from "vitest";
import { defaultCatalogRefsPath } from "../src/catalog-refs-path.js";

describe("bizquest catalog refs path", () => {
  it("scopes discovery cache under bizquest adapter", () => {
    const path = defaultCatalogRefsPath(
      "https://www.bizquest.com/businesses-for-sale-in-california-ca/",
    );
    expect(path).toContain("catalog-refs/bizquest/");
    expect(path).toContain("businesses-for-sale-in-california-ca.json");
  });
});
