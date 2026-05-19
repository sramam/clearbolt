import { describe, expect, it } from "vitest";
import { prepareSearchQuery } from "../src/query-prepare.js";

describe("prepareSearchQuery", () => {
  it("corrects common typos", () => {
    const p = prepareSearchQuery("manufacuring california");
    expect(p.searchKeywords).toContain("manufacturing");
    expect(p.didExpand).toBe(true);
    expect(p.expansions.some((e) => e.includes("manufacuring"))).toBe(true);
  });

  it("builds fts query with optional expansions", () => {
    const p = prepareSearchQuery("restaurant");
    expect(p.ftsQuery).toContain("restaurant");
    expect(p.ftsQuery).toContain("food");
  });

  it("returns empty for blank input", () => {
    expect(prepareSearchQuery("  ").ftsQuery).toBe("");
  });

  it("builds relaxed OR query for multi-token searches", () => {
    const p = prepareSearchQuery("pool services");
    expect(p.tokens).toEqual(["pool", "services"]);
    expect(p.ftsQueryRelaxed).toBe("pool | services");
  });
});
