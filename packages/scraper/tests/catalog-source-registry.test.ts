import { describe, expect, it } from "vitest";
import {
  CATALOG_SOURCES,
  catalogSourceForUrl,
  formatCatalogSourcesTable,
  isCatalogSourceId,
  resolveCatalogUrl,
} from "../src/catalog-source-registry.js";
import { BIZBUYSELL_CALIFORNIA_CATALOG_URL } from "../src/adapters/bizbuysell/catalog.js";
import { DEALSTREAM_CALIFORNIA_CATALOG_URL } from "../src/adapters/dealstream/catalog.js";

describe("catalog source registry", () => {
  it("lists all pre-V1 catalog crawlers", () => {
    const ids = CATALOG_SOURCES.map((s) => s.id);
    expect(ids).toContain("bizbuysell");
    expect(ids).toContain("businessbroker");
    expect(ids).toContain("dealstream");
    expect(ids).toContain("loopnet");
    expect(ids).toContain("businessesforsale");
  });

  it("resolveCatalogUrl prefers positional URL over --source default", () => {
    expect(
      resolveCatalogUrl("dealstream", BIZBUYSELL_CALIFORNIA_CATALOG_URL),
    ).toBe(BIZBUYSELL_CALIFORNIA_CATALOG_URL);
    expect(resolveCatalogUrl("dealstream", undefined)).toBe(
      DEALSTREAM_CALIFORNIA_CATALOG_URL,
    );
  });

  it("catalogSourceForUrl returns definition with ingest flags", () => {
    const bbs = catalogSourceForUrl(BIZBUYSELL_CALIFORNIA_CATALOG_URL);
    expect(bbs.id).toBe("bizbuysell");
    expect(bbs.ingestSupported).toBe(true);
    const loop = catalogSourceForUrl(
      CATALOG_SOURCES.find((s) => s.id === "loopnet")!.defaultCatalogUrl,
    );
    expect(loop.ingestSupported).toBe(false);
    expect(loop.browserRequired).toBe(true);
  });

  it("formatCatalogSourcesTable mentions each id", () => {
    const table = formatCatalogSourcesTable();
    for (const id of ["bizbuysell", "loopnet"]) {
      expect(table).toContain(id);
    }
  });

  it("isCatalogSourceId validates known ids", () => {
    expect(isCatalogSourceId("bizbuysell")).toBe(true);
    expect(isCatalogSourceId("unknown")).toBe(false);
  });
});
