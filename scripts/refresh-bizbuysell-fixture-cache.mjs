#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(repoRoot, name) });
}

const build = spawnSync(
  "pnpm",
  ["--filter", "@clearbolt/scraper", "run", "build"],
  { cwd: repoRoot, stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const modUrl = pathToFileURL(
  join(
    repoRoot,
    "packages",
    "scraper",
    "dist",
    "fixtures",
    "refresh-bizbuysell-live-cache.js",
  ),
).href;

const { refreshBizBuySellLiveCache } = await import(modUrl);

const searchUrl =
  process.env.BIZBUYSELL_FIXTURE_SEARCH_URL?.trim() ||
  "https://www.bizbuysell.com/businesses-for-sale/";
const listingLimit = Number.parseInt(
  process.env.BIZBUYSELL_FIXTURE_CACHE_LIMIT ?? "5",
  10,
);

const maskHtml = process.env.BIZBUYSELL_FIXTURE_MASK_HTML === "1";
const { outPath } = await refreshBizBuySellLiveCache({
  searchUrl,
  listingLimit: Number.isFinite(listingLimit) ? listingLimit : 5,
  maskHtml,
});
if (maskHtml) {
  console.log(
    "[fixtures:refresh] BIZBUYSELL_FIXTURE_MASK_HTML=1 (volatile markup stripped)",
  );
}
console.log(`[fixtures:refresh] wrote ${outPath}`);
