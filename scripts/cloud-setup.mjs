#!/usr/bin/env node
/**
 * One-shot cloud bootstrap for a developer machine:
 * 1) provision Neon + R2 (same CLI as `pnpm cloud:provision`)
 * 2) Prisma migrate deploy (when DATABASE_URL is present)
 * 3) optional: reset BizBuySell domain profile for HTTP/fixture runs on shared Neon
 * 4) optional: fixture scrape smoke against R2 + Neon (requires `pnpm build`)
 *
 * Usage:
 *   pnpm cloud:setup -- --env dev --write .env.dev
 *   pnpm cloud:setup -- --env dev --dry-run
 *   pnpm cloud:setup -- --no-provision --smoke --dev-defaults   # env already provisioned
 *
 * Flags for this runner: --no-provision, --no-migrate, --dev-defaults, --smoke, --help
 * All other flags are forwarded to `scripts/provision-cloud-env.mjs`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provisionScript = join(root, "scripts", "provision-cloud-env.mjs");
const migrateScript = join(root, "scripts", "db-migrate.mjs");
const cliDist = join(root, "apps", "cli", "dist", "cli.js");

function loadRepoEnv() {
  for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
    dotenv.config({ path: join(root, name) });
  }
}

/** @param {string} step @param {() => number} fn */
function phase(step, fn) {
  console.log(`\n[cloud-setup] ${step}`);
  const code = fn();
  if (code !== 0) process.exit(code);
}

/** @param {string} script @param {string[]} args */
function runNode(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

/** @param {string[]} argv */
function parse(argv) {
  let noProvision = false;
  let noMigrate = false;
  let devDefaults = false;
  let smoke = false;
  let help = false;
  const provisionArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--no-provision") noProvision = true;
    else if (a === "--no-migrate") noMigrate = true;
    else if (a === "--dev-defaults") devDefaults = true;
    else if (a === "--smoke") smoke = true;
    else provisionArgs.push(a);
  }

  const dryRun = provisionArgs.includes("--dry-run");
  return {
    noProvision,
    noMigrate,
    devDefaults,
    smoke,
    dryRun,
    help,
    provisionArgs,
  };
}

function printUsage() {
  console.log(`Usage: pnpm cloud:setup -- [runner flags] [provision flags]

Runner flags (this script):
  --no-provision   Skip Neon/R2 provisioning
  --no-migrate     Skip prisma migrate deploy
  --dev-defaults   CLEARBOLT_STORAGE=cloud: domain mark www.bizbuysell.com --http
  --smoke          CLEARBOLT_STORAGE=cloud: fixture scrape (needs pnpm build)
  -h, --help       This text

Provision flags (forwarded to pnpm cloud:provision):
  --env dev|staging|prod    (default dev inside provision script if omitted)
  --dry-run
  --write [.env.dev]
  --neon-only | --r2-only

Example:
  pnpm cloud:setup -- --env dev --write .env.dev
  pnpm cloud:setup -- --env dev --dry-run
  pnpm cloud:setup -- --no-provision --dev-defaults --smoke
`);
}

function main() {
  loadRepoEnv();
  const opts = parse(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  if (!opts.noProvision) {
    phase("provision (Neon + R2)", () =>
      runNode(provisionScript, opts.provisionArgs),
    );
    loadRepoEnv();
  }

  if (opts.dryRun) {
    console.log("\n[cloud-setup] dry-run: skipping migrate and post-steps");
    process.exit(0);
  }

  if (!opts.noMigrate) {
    if (!process.env.DATABASE_URL?.trim()) {
      console.error(
        "[cloud-setup] DATABASE_URL missing after provision; set .env.dev or run with --write .env.dev",
      );
      process.exit(1);
    }
    phase("database migrations (prisma migrate deploy)", () =>
      runNode(migrateScript, []),
    );
  }

  if (!opts.devDefaults && !opts.smoke) {
    console.log(`
[cloud-setup] done.

Next:
  set -a && source .env.dev && set +a   # if you use a new shell
  pnpm build
  CLEARBOLT_STORAGE=cloud CLEARBOLT_SCRAPE_LIMIT=10 CLEARBOLT_SKIP_BROWSER=1 \\
    pnpm clearbolt scrape "https://www.bizbuysell.com/businesses-for-sale/" --fixtures
`);
    process.exit(0);
  }

  if (!existsSync(cliDist)) {
    console.error(
      `[cloud-setup] ${cliDist} missing — run pnpm build before --dev-defaults / --smoke`,
    );
    process.exit(1);
  }

  const cloudEnv = { ...process.env, CLEARBOLT_STORAGE: "cloud" };

  if (opts.devDefaults) {
    phase(
      "dev defaults (BizBuySell HTTP lane for fixtures)",
      () =>
        spawnSync(
          process.execPath,
          [cliDist, "domain", "mark", "www.bizbuysell.com", "--http"],
          {
            cwd: root,
            env: cloudEnv,
            stdio: "inherit",
          },
        ).status ?? 1,
    );
  }

  if (opts.smoke) {
    phase(
      "smoke (fixture scrape → R2 + Neon)",
      () =>
        spawnSync(
          process.execPath,
          [
            cliDist,
            "scrape",
            "https://www.bizbuysell.com/businesses-for-sale/",
            "--fixtures",
          ],
          {
            cwd: root,
            env: {
              ...cloudEnv,
              CLEARBOLT_SCRAPE_LIMIT:
                process.env.CLEARBOLT_SCRAPE_LIMIT ?? "10",
              CLEARBOLT_SKIP_BROWSER: "1",
            },
            stdio: "inherit",
          },
        ).status ?? 1,
    );
  }

  console.log("\n[cloud-setup] all requested steps finished.");
  process.exit(0);
}

main();
