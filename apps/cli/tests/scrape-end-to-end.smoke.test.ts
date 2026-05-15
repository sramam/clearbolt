import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DiskMetadataStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run.js";

const fixtureSearch = "https://www.bizbuysell.com/businesses-for-sale/";

async function tmpDataDir(): Promise<string> {
  const tmp = join(
    import.meta.dirname,
    "..",
    "..",
    ".data-test",
    `smoke-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

describe("scrape-end-to-end smoke", () => {
  it("scrape_writes_records", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    try {
      await runCli(["node", "cli", "scrape", fixtureSearch, "--fixtures"]);
      const meta = new DiskMetadataStore(tmp);
      const canon = await meta.listCanonicalIds();
      expect(canon.length).toBeGreaterThanOrEqual(1);
      const sources = await readdir(join(tmp, "sources"));
      expect(sources.length).toBeGreaterThanOrEqual(1);
      const deals = await readdir(join(tmp, "deals"));
      expect(deals.length).toBeGreaterThanOrEqual(1);
      const mergedId = canon[0];
      expect(mergedId).toBeDefined();
      const merged = await meta.getCanonical(mergedId);
      const maxSources = Math.max(
        0,
        ...(await Promise.all(canon.map((id) => meta.getCanonical(id))))
          .filter((d): d is NonNullable<typeof d> => d != null)
          .map((d) => d.sourceIds.length),
      );
      expect(maxSources).toBeGreaterThanOrEqual(2);
      expect(merged?.sourceIds.length).toBeGreaterThanOrEqual(1);
    } finally {
      process.env.DATA_DIR = undefined;
      process.env.CLEARBOLT_SCRAPE_LIMIT = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("scrape_aborts_when_domain_marked_needs_browser", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    try {
      const domainDir = join(tmp, "domain");
      await mkdir(domainDir, { recursive: true });
      await writeFile(
        join(domainDir, "www.bizbuysell.com.json"),
        JSON.stringify({
          host: "www.bizbuysell.com",
          needsBrowser: true,
          lastUpdatedAt: new Date().toISOString(),
        }),
        "utf8",
      );
      await expect(
        runCli(["node", "cli", "scrape", fixtureSearch, "--fixtures"]),
      ).rejects.toThrow(/browser lane \(needsBrowser\)/);
    } finally {
      process.env.DATA_DIR = undefined;
      process.env.CLEARBOLT_SCRAPE_LIMIT = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rerun_yields_zero_new_canonicals", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    try {
      await runCli(["node", "cli", "scrape", fixtureSearch, "--fixtures"]);
      const meta = new DiskMetadataStore(tmp);
      const n1 = (await meta.listCanonicalIds()).length;
      await runCli(["node", "cli", "scrape", fixtureSearch, "--fixtures"]);
      const n2 = (await meta.listCanonicalIds()).length;
      expect(n2).toBe(n1);
    } finally {
      process.env.DATA_DIR = undefined;
      process.env.CLEARBOLT_SCRAPE_LIMIT = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
