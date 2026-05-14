import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DiskMetadataStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run.js";

describe("fixture scrape e2e", () => {
  it("scrape --fixtures writes sources and merges duplicate listing id", async () => {
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `cli-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    await runCli([
      "node",
      "cli",
      "scrape",
      "https://www.bizbuysell.com/businesses-for-sale/",
      "--fixtures",
    ]);
    const meta = new DiskMetadataStore(tmp);
    const canon = await meta.listCanonicalIds();
    expect(canon.length).toBeGreaterThanOrEqual(1);
    const firstId = canon[0];
    expect(firstId).toBeDefined();
    const deal = await meta.getCanonical(firstId);
    expect(deal?.sourceIds.length).toBeGreaterThanOrEqual(1);
    const nCanonBefore = canon.length;
    await runCli(["node", "cli", "replay"]);
    expect((await meta.listCanonicalIds()).length).toBe(nCanonBefore);
    process.env.DATA_DIR = undefined;
    process.env.CLEARBOLT_SCRAPE_LIMIT = undefined;
    await rm(tmp, { recursive: true, force: true });
  });
});
