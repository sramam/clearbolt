#!/usr/bin/env node
/**
 * Dev-only: truncate Neon metadata tables, then refresh BizBuySell live fixture cache.
 * Invokes dev-metadata-reset with CLEARBOLT_FIXTURES_RECOVER=1 (no manual env needed).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(repoRoot, name) });
}

const env = {
  ...process.env,
  CLEARBOLT_FIXTURES_RECOVER: "1",
};

const reset = spawnSync(
  "pnpm",
  [
    "--filter",
    "@clearbolt/storage-neon",
    "exec",
    "node",
    "./scripts/dev-metadata-reset.mjs",
    "--confirm",
  ],
  { cwd: repoRoot, stdio: "inherit", env },
);
if (reset.status !== 0) process.exit(reset.status ?? 1);

const refresh = spawnSync("pnpm", ["fixtures:refresh"], {
  cwd: repoRoot,
  stdio: "inherit",
});
process.exit(refresh.status ?? 1);
