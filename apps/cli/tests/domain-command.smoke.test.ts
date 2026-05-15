import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DiskMetadataStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run.js";

async function tmpDataDir(): Promise<string> {
  const tmp = join(
    import.meta.dirname,
    "..",
    "..",
    ".data-test",
    `domain-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

describe("domain command", () => {
  it("mark_browser_then_mark_http_updates_profile", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    try {
      await runCli([
        "node",
        "cli",
        "domain",
        "mark",
        "www.bizbuysell.com",
        "--browser",
      ]);
      let meta = new DiskMetadataStore(tmp);
      let p = await meta.getDomainProfile("www.bizbuysell.com");
      expect(p?.needsBrowser).toBe(true);

      await runCli([
        "node",
        "cli",
        "domain",
        "mark",
        "https://www.bizbuysell.com/foo",
        "--http",
      ]);
      meta = new DiskMetadataStore(tmp);
      p = await meta.getDomainProfile("www.bizbuysell.com");
      expect(p?.needsBrowser).toBe(false);
    } finally {
      process.env.DATA_DIR = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("mark_rejects_zero_or_two_lane_flags", async () => {
    const tmp = await tmpDataDir();
    process.env.DATA_DIR = tmp;
    try {
      await expect(
        runCli(["node", "cli", "domain", "mark", "a.example.com"]),
      ).rejects.toThrow(/exactly one of/);

      await expect(
        runCli([
          "node",
          "cli",
          "domain",
          "mark",
          "a.example.com",
          "--browser",
          "--http",
        ]),
      ).rejects.toThrow(/exactly one of/);
    } finally {
      process.env.DATA_DIR = undefined;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
