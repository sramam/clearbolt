#!/usr/bin/env node
/** Quick check: HTTP+Decodo vs Playwright for one catalog URL. */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  config({ path: join(root, name) });
}

const url =
  process.argv[2] ??
  "https://m.bizbuysell.com/california-businesses-for-sale/";

const { HttpFetcher } = await import("../packages/scraper/dist/http-fetcher.js");
const { primeBizBuySellResidentialHosts } = await import(
  "../packages/scraper/dist/bizbuysell-run-policy.js"
);
const { openBrowserSession } = await import(
  "../packages/scraper/dist/browser-fetcher.js"
);

primeBizBuySellResidentialHosts();

console.log("--- HTTP + proxy ---");
const http = new HttpFetcher();
const hres = await http.fetch({ url });
console.log("status:", hres.status, "bytes:", hres.body.length);

console.log("--- Playwright + proxy ---");
const session = await openBrowserSession({
  proxyHostHint: new URL(url).hostname,
  headless: true,
});
if (session) {
  const bres = await session.fetcher.fetch({ url });
  console.log("status:", bres.status, "bytes:", bres.body.length);
  await session.close();
} else {
  console.log("no browser session");
}
