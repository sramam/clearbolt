#!/usr/bin/env node
/**
 * Installs Playwright Chromium for @clearbolt/scraper (optional dependency).
 * Run after `pnpm install` on any machine or image that will use the browser lane.
 *
 * Env:
 *   CLEARBOLT_SKIP_PLAYWRIGHT_INSTALL=1 — exit 0 without doing anything (CI smoke-only, etc.)
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.CLEARBOLT_SKIP_PLAYWRIGHT_INSTALL === "1") {
  console.log(
    "[ensure-playwright] CLEARBOLT_SKIP_PLAYWRIGHT_INSTALL=1 — skipping Chromium install",
  );
  process.exit(0);
}

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@clearbolt/scraper",
    "exec",
    "playwright",
    "install",
    "chromium",
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.error) {
  console.error("[ensure-playwright]", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "[ensure-playwright] playwright install failed (try `pnpm install` from repo root, then re-run)",
  );
  process.exit(result.status ?? 1);
}

console.log("[ensure-playwright] Chromium ready for @clearbolt/scraper");
