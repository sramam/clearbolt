import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEvidenceStoreConformance } from "@clearbolt/storage/conformance";
import dotenv from "dotenv";
import { afterAll, describe, it } from "vitest";
import { R2EvidenceStore, r2EvidenceConfigFromEnv } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: join(root, ".env.cloud.local") });
dotenv.config({ path: join(root, ".env.dev") });

const config = r2EvidenceConfigFromEnv();
const describeR2 = config ? describe : describe.skip;

describeR2("R2EvidenceStore", () => {
  let store: R2EvidenceStore | undefined;

  afterAll(() => {
    store?.disconnect();
  });

  describe("conformance", () => {
    it("put, head, get, exists, idempotent put against dev bucket", async () => {
      if (!config) throw new Error("R2 env not configured");
      store = new R2EvidenceStore(config);
      await assertEvidenceStoreConformance(store);
    }, 60_000);
  });
});
