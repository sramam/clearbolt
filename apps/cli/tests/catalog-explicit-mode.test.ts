import { describe, expect, it } from "vitest";
import { catalogArgsHaveExplicitMode } from "../src/catalog-interactive.js";

describe("catalogArgsHaveExplicitMode", () => {
  it("returns true for --retry-failures-only without a URL", () => {
    expect(catalogArgsHaveExplicitMode(["--retry-failures-only"])).toBe(true);
  });

  it("returns true for --refresh and --discover-only", () => {
    expect(catalogArgsHaveExplicitMode(["--refresh"])).toBe(true);
    expect(catalogArgsHaveExplicitMode(["--discover-only"])).toBe(true);
  });

  it("returns true for --refs-file with a path", () => {
    expect(
      catalogArgsHaveExplicitMode(["--refs-file", "data/catalog-refs/x.json"]),
    ).toBe(true);
  });

  it("returns false for bare catalog (interactive resume allowed)", () => {
    expect(catalogArgsHaveExplicitMode([])).toBe(false);
    expect(catalogArgsHaveExplicitMode(["--headed"])).toBe(false);
  });
});
