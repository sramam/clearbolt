import { describe, expect, it } from "vitest";
import {
  catalogUrlFromArgs,
  parseCatalogSourceFlag,
} from "../src/catalog-interactive.js";

describe("catalog interactive args", () => {
  it("parseCatalogSourceFlag extracts --source", () => {
    const { sourceId, rest } = parseCatalogSourceFlag([
      "--source",
      "dealstream",
      "--discover-only",
      "--pages",
      "3",
    ]);
    expect(sourceId).toBe("dealstream");
    expect(rest).toEqual(["--discover-only", "--pages", "3"]);
  });

  it("catalogUrlFromArgs uses source default when no URL", () => {
    const url = catalogUrlFromArgs("businessbroker", undefined);
    expect(url).toContain("businessbroker.net");
    expect(url).toContain("california");
  });
});
