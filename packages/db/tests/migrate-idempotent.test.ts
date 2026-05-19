import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { neonMetadataConfigFromEnv } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const neonPkg = join(root, "packages", "db");

dotenv.config({ path: join(root, ".env.cloud.local") });
dotenv.config({ path: join(root, ".env.dev") });

const config = neonMetadataConfigFromEnv();
const describeNeon = config ? describe : describe.skip;

function migrateDeploy(): number {
  const r = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: neonPkg,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    const err = [r.stdout, r.stderr].filter(Boolean).join("\n");
    throw new Error(`prisma migrate deploy failed (${r.status}): ${err}`);
  }
  return r.status ?? 1;
}

describeNeon("Neon migrations", () => {
  it("migrate deploy is idempotent on an up-to-date database", () => {
    expect(migrateDeploy()).toBe(0);
    expect(migrateDeploy()).toBe(0);
  }, 120_000);
});
