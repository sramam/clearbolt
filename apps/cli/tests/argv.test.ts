import { describe, expect, it } from "vitest";
import { positionalArgs } from "../src/argv.js";

describe("positionalArgs", () => {
  it("ignores valued flags and their arguments", () => {
    expect(
      positionalArgs(["--discover-only", "--ingest", "50", "--pages", "3"]),
    ).toEqual([]);
    expect(
      positionalArgs([
        "https://www.bizbuysell.com/california-businesses-for-sale/",
        "--ingest",
        "50",
      ]),
    ).toEqual(["https://www.bizbuysell.com/california-businesses-for-sale/"]);
  });
});
