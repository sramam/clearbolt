import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertWikiStoreConformance } from "@clearbolt/storage/conformance";
import { afterAll, beforeAll, describe, it } from "vitest";
import { WikiFsStore } from "../src/index.js";

describe("WikiFsStore", () => {
  let root: string;
  let store: WikiFsStore;

  beforeAll(async () => {
    root = join(
      import.meta.dirname,
      "..",
      ".data-test",
      `wiki-fs-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(root, { recursive: true });
    store = new WikiFsStore(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("conformance", async () => {
    await assertWikiStoreConformance(store);
  });
});
