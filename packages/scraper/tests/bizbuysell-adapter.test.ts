import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverListingRefs,
  parseListingPage,
} from "../src/adapters/bizbuysell.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("bizbuysell adapter", () => {
  it("discovers listing refs from fixture search page", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizbuysell-search.html"),
      "utf8",
    );
    const refs: { url: string; externalId?: string }[] = [];
    for await (const r of discoverListingRefs(
      html,
      "https://www.bizbuysell.com/businesses-for-sale/",
    )) {
      refs.push(r);
    }
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.some((r) => r.externalId === "1234567")).toBe(true);
  });

  it("parses listing fixture", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizbuysell-listing-1234567.html"),
      "utf8",
    );
    const p = parseListingPage(
      html,
      "https://www.bizbuysell.com/california-business-for-sale/1234567/",
    );
    expect(p.title).toContain("Acme");
    expect(p.askingPrice).toBe(450_000);
    expect(p.externalId).toBe("1234567");
  });
});
