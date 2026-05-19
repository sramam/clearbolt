#!/usr/bin/env node
/**
 * Run BizBuySell scrape outside the Next.js process (Playwright + Serper + storage).
 * Usage: node scripts/web-bizbuysell-scrape.mjs '<json-payload>'
 * Progress: stderr lines `PROGRESS:` + JSON
 * Result: stdout last line JSON
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(root, name) });
}

const scraperEntry = join(
  root,
  "packages/scraper/dist/run-bizbuysell-scrape.js",
);
const bindStoragePath = join(root, "apps/cli/dist/bind-storage.js");

for (const [label, path] of [
  ["scraper", scraperEntry],
  ["cli bind-storage", bindStoragePath],
]) {
  if (!existsSync(path)) {
    console.error(
      JSON.stringify({
        error: `${label} not built (${path}). Run: pnpm exec tsc -b packages/scraper apps/cli`,
      }),
    );
    process.exit(1);
  }
}

const payload = JSON.parse(process.argv[2] ?? "{}");
const { bindStorage } = await import(bindStoragePath);
const { runBizBuySellScrape } = await import(scraperEntry);

function emitProgress(event) {
  process.stderr.write(`PROGRESS:${JSON.stringify(event)}\n`);
}

const { evidence, processedArtifacts, metadata, disconnect } =
  await bindStorage();
try {
  const result = await runBizBuySellScrape({
    searchUrl: payload.searchUrl,
    searchKeywords: payload.searchKeywords,
    evidence,
    processedArtifacts,
    metadata,
    limit: payload.limit,
    useFixtures: payload.useFixtures,
    discovery: payload.discovery,
    skipBrowser: payload.skipBrowser,
    concurrency: payload.concurrency,
    onProgress: emitProgress,
  });
  console.log(JSON.stringify(result));
} catch (e) {
  console.error(
    JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
} finally {
  await disconnect?.();
}
