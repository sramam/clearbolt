#!/usr/bin/env node
/**
 * Live catalog discovery smoke for every registered source except BizBuySell.
 *
 * Runs `clearbolt catalog --source <id> --discover-only --force-discovery --pages N`
 * for each marketplace into an isolated DATA_DIR (default `data/catalog-probe`).
 *
 * Usage:
 *   pnpm catalog:test-sources
 *   pnpm catalog:test-sources -- --pages 3
 *   pnpm catalog:test-sources -- --source dealstream
 *   DATA_DIR=./data/catalog-probe pnpm catalog:test-sources
 *
 * Requires: `pnpm exec tsc -b packages/scraper apps/cli` (or `pnpm typecheck`)
 * Browser sources need Playwright (`pnpm ensure:playwright`) and must not set
 * CLEARBOLT_SKIP_BROWSER=1.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  config({ path: join(root, name) });
}

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
}

const pages = Number.parseInt(
  flagValue("--pages") ?? process.env.CATALOG_PROBE_PAGES ?? "2",
  10,
);
const onlySource = flagValue("--source");
const dataDir =
  flagValue("--data-dir") ??
  process.env.CATALOG_PROBE_DATA_DIR ??
  join(root, "data", "catalog-probe");

const cliEntry = join(root, "apps/cli/dist/cli.js");
if (!existsSync(cliEntry)) {
  console.error(
    "CLI not built. Run: pnpm exec tsc -b packages/scraper apps/cli",
  );
  process.exit(1);
}

const { CATALOG_SOURCES } = await import(
  join(root, "packages/scraper/dist/index.js")
);

const skipBrowser = process.env.CLEARBOLT_SKIP_BROWSER === "1";
let sources = CATALOG_SOURCES.filter((s) => s.id !== "bizbuysell");
if (onlySource) {
  sources = sources.filter((s) => s.id === onlySource);
  if (sources.length === 0) {
    console.error(
      `Unknown or excluded source "${onlySource}". Non-BizBuySell ids: ${CATALOG_SOURCES.filter(
        (s) => s.id !== "bizbuysell",
      )
        .map((s) => s.id)
        .join(", ")}`,
    );
    process.exit(1);
  }
}

if (sources.length === 0) {
  console.error("No catalog sources to probe.");
  process.exit(1);
}

await mkdir(dataDir, { recursive: true });

async function countRefsForAdapter(adapterId) {
  const base = join(dataDir, "catalog-refs", adapterId);
  if (!existsSync(base)) return 0;
  let total = 0;
  const walk = async (dir) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.name.endsWith(".json")) {
        try {
          const file = JSON.parse(readFileSync(p, "utf8"));
          if (Array.isArray(file.refs)) total += file.refs.length;
        } catch {
          /* ignore */
        }
      }
    }
  };
  await walk(base);
  return total;
}

console.log(`Catalog probe DATA_DIR=${dataDir}`);
console.log(`Pages per source: ${pages}`);
if (skipBrowser) {
  console.warn(
    "WARNING: CLEARBOLT_SKIP_BROWSER=1 — browser-required sources will likely fail.",
  );
}
console.log(`Sources: ${sources.map((s) => s.id).join(", ")}\n`);

const results = [];

for (const source of sources) {
  if (source.browserRequired && skipBrowser) {
    results.push({
      id: source.id,
      ok: false,
      skipped: true,
      reason: "CLEARBOLT_SKIP_BROWSER=1",
    });
    console.log(`⊘ ${source.id} — skipped (browser required)\n`);
    continue;
  }

  console.log(`── ${source.label} (${source.id}) ──`);
  console.log(`   ${source.defaultCatalogUrl}`);

  const args = [
    cliEntry,
    "catalog",
    "--source",
    source.id,
    "--discover-only",
    "--force-discovery",
    "--pages",
    String(pages),
  ];

  const started = Date.now();
  const run = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: "inherit",
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const exitOk = run.status === 0;
  const refCount = exitOk ? await countRefsForAdapter(source.id) : 0;
  const zeroRefs = exitOk && refCount === 0;
  const ok = exitOk && !zeroRefs;
  results.push({
    id: source.id,
    ok,
    exitOk,
    refCount,
    zeroRefs,
    elapsedSec: elapsed,
  });
  if (zeroRefs) {
    console.log(
      `✗ ${source.id} discovered 0 listing refs (WAF block or parser drift) in ${elapsed}s\n`,
    );
  } else {
    console.log(
      ok
        ? `✓ ${source.id} discovered ${refCount} ref(s) in ${elapsed}s\n`
        : `✗ ${source.id} failed (exit ${run.status ?? "?"})\n`,
    );
  }
}

console.log("── summary ──");
let failed = 0;
for (const r of results) {
  if (r.skipped) {
    console.log(`  ⊘ ${r.id} skipped (${r.reason})`);
    failed++;
    continue;
  }
  if (r.zeroRefs) {
    console.log(`  ✗ ${r.id} — 0 refs (${r.elapsedSec}s)`);
    failed++;
    continue;
  }
  console.log(
    r.ok
      ? `  ✓ ${r.id} — ${r.refCount} refs (${r.elapsedSec}s)`
      : `  ✗ ${r.id}`,
  );
  if (!r.ok) failed++;
}
console.log(`\nRefs under: ${dataDir}/catalog-refs/<adapter>/`);

process.exit(failed > 0 ? 1 : 0);
