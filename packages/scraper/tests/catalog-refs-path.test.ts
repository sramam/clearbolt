import { describe, expect, it } from "vitest";
import {
  catalogRefsReadPathCandidates,
  catalogSlugFromUrl,
  defaultCatalogRefsPath,
  legacyFlatCatalogRefsPath,
  legacyHostCatalogRefsPath,
} from "../src/catalog-refs-path.js";

describe("catalog refs path", () => {
  it("derives adapter-scoped slug from catalog URL", () => {
    expect(
      catalogSlugFromUrl(
        "https://www.bizbuysell.com/california-businesses-for-sale/",
      ),
    ).toBe("bizbuysell/california-businesses-for-sale");
    expect(
      defaultCatalogRefsPath(
        "https://www.bizbuysell.com/california-businesses-for-sale/",
      ),
    ).toContain("catalog-refs/bizbuysell/california-businesses-for-sale.json");
  });

  it("does not collide across adapters for the same regional path", () => {
    const bbs = defaultCatalogRefsPath(
      "https://www.bizbuysell.com/california-businesses-for-sale/",
    );
    const ds = defaultCatalogRefsPath(
      "https://dealstream.com/california-businesses-for-sale",
    );
    expect(bbs).not.toBe(ds);
    expect(bbs).toContain(
      "catalog-refs/bizbuysell/california-businesses-for-sale.json",
    );
    expect(ds).toContain(
      "catalog-refs/dealstream/california-businesses-for-sale.json",
    );
  });

  it("lists legacy paths as fallback readers", () => {
    const url = "https://www.bizbuysell.com/california-businesses-for-sale/";
    const candidates = catalogRefsReadPathCandidates(url);
    expect(candidates[0]).toBe(defaultCatalogRefsPath(url));
    expect(candidates).toContain(legacyHostCatalogRefsPath(url));
    expect(candidates).toContain(legacyFlatCatalogRefsPath(url));
    expect(legacyFlatCatalogRefsPath(url)).toContain(
      "catalog-refs/california-businesses-for-sale.json",
    );
  });
});
