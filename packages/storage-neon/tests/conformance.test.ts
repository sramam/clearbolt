import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMetadataStoreConformance } from "@clearbolt/storage/conformance";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, it } from "vitest";
import { NeonMetadataStore, neonMetadataConfigFromEnv } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: join(root, ".env.cloud.local") });
dotenv.config({ path: join(root, ".env.dev") });

const config = neonMetadataConfigFromEnv();
const describeNeon = config ? describe : describe.skip;

describeNeon("NeonMetadataStore", () => {
  let store: NeonMetadataStore;

  beforeAll(async () => {
    if (!config) throw new Error("DATABASE_URL not configured");
    store = new NeonMetadataStore(config);
  });

  afterAll(async () => {
    await store?.disconnect();
  });

  describe("conformance", () => {
    it("sources, canonicals, dedup index, domain profiles", async () => {
      await assertMetadataStoreConformance(store);
    }, 60_000);
  });
});
