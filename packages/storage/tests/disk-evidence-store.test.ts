import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "vitest";
import { assertEvidenceStoreConformance } from "../src/conformance/evidence.suite.js";
import { DiskEvidenceStore } from "../src/disk-evidence-store.js";

describe("DiskEvidenceStore", () => {
  describe("conformance", () => {
    it("put, head, get, exists, idempotent put", async () => {
      const tmp = join(
        import.meta.dirname,
        "..",
        ".data-test",
        `ev-${randomBytes(4).toString("hex")}`,
      );
      await mkdir(tmp, { recursive: true });
      const store = new DiskEvidenceStore(tmp);

      await assertEvidenceStoreConformance(store);

      await rm(tmp, { recursive: true, force: true });
    });
  });
});
