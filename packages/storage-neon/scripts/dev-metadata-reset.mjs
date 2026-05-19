#!/usr/bin/env node
/**
 * Truncates V0 metadata tables (dev recovery). Requires explicit ack env + --confirm.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const neonRoot = join(__dirname, "..");
const repoRoot = join(neonRoot, "..", "..");

for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(repoRoot, name) });
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("[dev-metadata-reset] DATABASE_URL is required");
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.includes("--confirm")) {
  console.error(
    "[dev-metadata-reset] Refuses to run without --confirm (truncates source_records, canonical_deals, dedup_mappings, domain_profiles)",
  );
  process.exit(1);
}

if (
  process.env.CLEARBOLT_DEV_METADATA_RESET !== "1" &&
  process.env.CLEARBOLT_FIXTURES_RECOVER !== "1"
) {
  console.error(
    "[dev-metadata-reset] Set CLEARBOLT_DEV_METADATA_RESET=1 to acknowledge dev-only destructive reset (or run via pnpm fixtures:recover)",
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(
    "TRUNCATE TABLE source_records, canonical_deals, dedup_mappings, domain_profiles RESTART IDENTITY CASCADE",
  );
  console.log("[dev-metadata-reset] Truncated metadata tables.");
} finally {
  await pool.end();
}
