#!/usr/bin/env node
/**
 * Dev-only: drop all data and re-apply migrations from scratch (`prisma migrate reset --force`).
 * Requires --confirm and DATABASE_URL (from .env.cloud.local / .env.dev).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbPkg = join(root, "packages", "db");

for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(root, name) });
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error("[db:reset-dev] DATABASE_URL is required");
  process.exit(1);
}

if (!process.argv.includes("--confirm")) {
  console.error(
    "[db:reset-dev] Destructive: wipes the database and reapplies migrations. Re-run with --confirm",
  );
  process.exit(1);
}

console.log("[db:reset-dev] prisma migrate reset --force …");
const r = spawnSync("pnpm", ["exec", "prisma", "migrate", "reset", "--force"], {
  cwd: dbPkg,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status ?? 1);
