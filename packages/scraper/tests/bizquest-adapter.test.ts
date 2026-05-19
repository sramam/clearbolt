import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverListingRefs,
  discoverNextSearchPageUrl,
  parseListingPage,
} from "../src/adapters/bizquest.js";
import { BIZQUEST_FIXTURE_SEARCH_URL } from "../src/fixtures/build-bizquest-fixture-fetcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("bizquest adapter", () => {
  it("discovers listing refs from fixture search page", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizquest-search.html"),
      "utf8",
    );
    const refs: { url: string; externalId?: string }[] = [];
    for await (const r of discoverListingRefs(html, BIZQUEST_FIXTURE_SEARCH_URL)) {
      refs.push(r);
    }
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.externalId === "BW2486214")).toBe(true);
    expect(refs.some((r) => r.externalId === "BW2482881")).toBe(true);
  });

  it("discovers next search page from fixture", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizquest-search.html"),
      "utf8",
    );
    const next = discoverNextSearchPageUrl(html, BIZQUEST_FIXTURE_SEARCH_URL);
    expect(next).toContain("/page-2/");
  });

  it("parses listing fixture", async () => {
    const html = await readFile(
      join(__dirname, "fixtures", "bizquest-listing-BW2486214.html"),
      "utf8",
    );
    const p = parseListingPage(
      html,
      "https://www.bizquest.com/business-for-sale/pizza-franchise/BW2486214/",
    );
    expect(p.title).toContain("Pizza Franchise");
    expect(p.askingPrice).toBe(350_000);
    expect(p.externalId).toBe("BW2486214");
    expect(p.state).toBe("CA");
    expect(p.city).toBe("Bakersfield");
  });
});
