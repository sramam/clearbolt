import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readCatalogRefsFile,
  writeCatalogRefsFile,
} from "../src/catalog-refs-file.js";

describe("catalog refs file", () => {
  it("round-trips refs with normalization", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catalog-refs-"));
    const path = join(dir, "refs.json");
    try {
      await writeCatalogRefsFile(path, {
        catalogUrl:
          "https://www.bizbuysell.com/california-businesses-for-sale/",
        refs: [
          {
            url: "https://www.bizbuysell.com/business-opportunity/a/1111001/",
          },
          {
            url: "https://m.bizbuysell.com/business-opportunity/a/1111001/",
          },
        ],
      });
      const loaded = await readCatalogRefsFile(path);
      expect(loaded.refs).toHaveLength(1);
      expect(loaded.refs[0]?.externalId).toBe("1111001");
      const raw = JSON.parse(await readFile(path, "utf8")) as {
        version: number;
      };
      expect(raw.version).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
