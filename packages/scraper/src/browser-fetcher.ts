import type { FetchRequest, RawResponse } from "@clearbolt/core";
import type { Fetcher } from "./fetcher.js";

export type BrowserSession = {
  fetcher: Fetcher;
  close: () => Promise<void>;
};

/**
 * One Chromium process for many fetches (CLI scrape). Call `close()` when done.
 * Returns null when Playwright is missing, `CLEARBOLT_SKIP_BROWSER=1`, or import fails.
 */
export async function openBrowserSession(): Promise<BrowserSession | null> {
  if (process.env.CLEARBOLT_SKIP_BROWSER === "1") return null;
  try {
    const pw = await import("playwright");
    const browser = await pw.chromium.launch({ headless: true });
    const fetcher: Fetcher = {
      async fetch(req: FetchRequest): Promise<RawResponse> {
        const page = await browser.newPage();
        try {
          const resp = await page.goto(req.url, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          const status = resp?.status() ?? 200;
          const body = await page.content();
          return {
            status,
            body,
            finalUrl: page.url(),
            headers: {},
          };
        } finally {
          await page.close();
        }
      },
    };
    return {
      fetcher,
      close: async () => {
        await browser.close();
      },
    };
  } catch {
    return null;
  }
}
