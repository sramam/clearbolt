#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(root, name) });
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "[db:migrate:dev] DATABASE_URL is required (set in .env.dev or .env.cloud.local)",
  );
  process.exit(1);
}

const dbPkg = join(root, "packages", "db");
const extra = process.argv.slice(2);
const r = spawnSync("pnpm", ["exec", "prisma", "migrate", "dev", ...extra], {
  cwd: dbPkg,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status ?? 1);
