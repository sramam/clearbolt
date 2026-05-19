import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DiskMetadataStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run.js";

/** Search URL (not catalog index) so `clearbolt scrape` uses fixture search HTML. */
const fixtureSearch =
  "https://www.bizbuysell.com/businesses-for-sale/?q=smoke-fixture";
const fixtureCatalog = "https://www.bizbuysell.com/businesses-for-sale/";
const fixtureRefs = [
  {
    url: "https://www.bizbuysell.com/california-business-for-sale/1234567/",
    externalId: "1234567",
  },
  {
    url: "https://www.bizbuysell.com/florida-business-for-sale/1234567/",
    externalId: "1234567",
  },
];

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

function clearProxyEnvForSmoke(): void {
  for (const key of [
    "CLEARBOLT_PROXY_ENDPOINTS_FILE",
    "CLEARBOLT_PROXY_RESIDENTIAL",
    "CLEARBOLT_PROXY_DATACENTER",
    "CLEARBOLT_PROXY_SESSION_ID",
    "CLEARBOLT_PROXY_POLICY",
  ]) {
    delete process.env[key];
  }
  process.env.CLEARBOLT_PROXY_POLICY = "direct";
  process.env.CLEARBOLT_BIZBUYSELL_INGEST_HTTP = "0";
}

describe("scrape-end-to-end smoke", () => {
  it("scrape_writes_records", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN = "0";
    process.env.CLEARBOLT_LISTING_FETCH_COOLDOWN = "0";
    clearProxyEnvForSmoke();
    const writeRefs = async (path: string, refs: typeof fixtureRefs) => {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          adapter: "bizbuysell",
          catalogUrl: fixtureCatalog,
          discoveredAt: new Date().toISOString(),
          refs,
        }),
        "utf8",
      );
    };
    try {
      await writeRefs(join(tmp, "fixture-refs-ca.json"), [fixtureRefs[0]]);
      await writeRefs(join(tmp, "fixture-refs-fl.json"), [fixtureRefs[1]]);
      await runCli([
        "node",
        "cli",
        "catalog",
        fixtureCatalog,
        "--refs-file",
        join(tmp, "fixture-refs-ca.json"),
        "--fixtures",
        "--ingest",
        "10",
      ]);
      process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN = "0";
      await runCli([
        "node",
        "cli",
        "catalog",
        fixtureCatalog,
        "--refs-file",
        join(tmp, "fixture-refs-fl.json"),
        "--fixtures",
        "--ingest",
        "10",
      ]);
      const meta = new DiskMetadataStore(tmp);
      const canon = await meta.listCanonicalIds();
      expect(canon.length).toBeGreaterThanOrEqual(1);
      await stat(join(tmp, "sources", "bizbuysell"));
      await stat(join(tmp, "deals", "bizbuysell"));
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
      process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN = undefined;
      process.env.CLEARBOLT_LISTING_FETCH_COOLDOWN = undefined;
      process.env.CLEARBOLT_BIZBUYSELL_INGEST_HTTP = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("scrape_aborts_when_domain_marked_needs_browser", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    process.env.CLEARBOLT_SKIP_BROWSER = "1";
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
      ).rejects.toThrow(/requires the browser lane/);
    } finally {
      process.env.DATA_DIR = undefined;
      process.env.CLEARBOLT_SCRAPE_LIMIT = undefined;
      process.env.CLEARBOLT_SKIP_BROWSER = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rerun_yields_zero_new_canonicals", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    clearProxyEnvForSmoke();
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
