import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalDeal } from "@clearbolt/core";
import { DiskMetadataStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run.js";

const fixtureSearch =
  "https://www.bizbuysell.com/businesses-for-sale/?q=smoke-fixture";

async function canonicalDealsById(
  meta: DiskMetadataStore,
): Promise<Record<string, CanonicalDeal>> {
  const out: Record<string, CanonicalDeal> = {};
  for (const id of (await meta.listCanonicalIds()).sort()) {
    const d = await meta.getCanonical(id);
    if (d) out[id] = d;
  }
  return out;
}

describe("replay smoke", () => {
  it("replay_reproduces_canonicals_offline", async () => {
    const tmp = join(
      import.meta.dirname,
      "..",
      "..",
      ".data-test",
      `replay-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    process.env.DATA_DIR = tmp;
    process.env.CLEARBOLT_SCRAPE_LIMIT = "10";
    delete process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE;
    delete process.env.CLEARBOLT_PROXY_RESIDENTIAL;
    delete process.env.CLEARBOLT_PROXY_POLICY;
    process.env.CLEARBOLT_PROXY_POLICY = "direct";
    process.env.CLEARBOLT_BIZBUYSELL_INGEST_HTTP = "0";
    try {
      await runCli(["node", "cli", "scrape", fixtureSearch, "--fixtures"]);
      const meta = new DiskMetadataStore(tmp);
      const before = await canonicalDealsById(meta);
      expect(Object.keys(before).length).toBeGreaterThan(0);
      await runCli(["node", "cli", "replay"]);
      const after = await canonicalDealsById(meta);
      expect(after).toEqual(before);
    } finally {
      process.env.DATA_DIR = undefined;
      process.env.CLEARBOLT_SCRAPE_LIMIT = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
