import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverTransworldBrokerRefsFromSitemap,
  isTransworldOfficeLocationUrl,
} from "../src/adapters/transworld.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

describe("transworld adapter", () => {
  it("keeps office roots only", () => {
    expect(
      isTransworldOfficeLocationUrl(
        "https://www.tworld.com/locations/california/los-angeles",
      ),
    ).toBe(true);
    expect(
      isTransworldOfficeLocationUrl(
        "https://www.tworld.com/locations/california/los-angeles/blog",
      ),
    ).toBe(false);
  });

  it("parses locations sitemap fixture", async () => {
    const xml = await readFile(
      join(fixtureDir, "fixtures/transworld-locations-snippet.xml"),
      "utf8",
    );
    const refs = discoverTransworldBrokerRefsFromSitemap(xml);
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.sourceAdapter === "transworld")).toBe(true);
    expect(refs.map((r) => r.state).sort()).toEqual(["CALIFORNIA", "TEXAS"]);
  });
});
