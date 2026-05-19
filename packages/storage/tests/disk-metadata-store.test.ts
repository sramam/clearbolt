import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "vitest";
import { assertMetadataStoreConformance } from "../src/conformance/metadata.suite.js";
import { DiskMetadataStore } from "../src/disk-metadata-store.js";

async function tmpRoot(): Promise<string> {
  const tmp = join(
    import.meta.dirname,
    "..",
    ".data-test",
    `md-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

describe("DiskMetadataStore", () => {
  describe("conformance", () => {
    it("sources, canonicals, dedup index, domain profiles", async () => {
      const tmp = await tmpRoot();
      const store = new DiskMetadataStore(tmp);
      await assertMetadataStoreConformance(store);
      await rm(tmp, { recursive: true, force: true });
    });
  });
});
