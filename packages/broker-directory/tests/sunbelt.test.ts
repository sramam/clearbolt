import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverSunbeltBrokerRefsFromHtml } from "../src/adapters/sunbelt.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

describe("sunbelt adapter", () => {
  it("parses office links from locations HTML", async () => {
    const html = await readFile(
      join(fixtureDir, "fixtures/sunbelt-locations-snippet.html"),
      "utf8",
    );
    const refs = discoverSunbeltBrokerRefsFromHtml(html);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.websiteDomain).toBe("sunbeltnetwork.com");
    expect(refs.some((r) => r.externalBrokerId === "bakersfield-ca")).toBe(
      true,
    );
  });
});
