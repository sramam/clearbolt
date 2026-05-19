import type { FetchRequest, RawResponse } from "@clearbolt/core";
import {
  isBizBuySellCatalogUrl,
  isBizBuySellListingUrl,
} from "./bizbuysell-listing-url.js";
import { primeBizBuySellResidentialHosts } from "./bizbuysell-run-policy.js";
import {
  installBrowserResourceBlocking,
  preferBundledChromiumForProxy,
} from "./browser-resource-block.js";
import { listingLinkSelectorForUrl } from "./catalog-listing-link-selectors.js";
import type { Fetcher } from "./fetcher.js";
import {
  type ProxyTier,
  markHostUseResidential,
  playwrightProxyOptions,
  proxyTierForHost,
} from "./proxy-config.js";
import { isHardAkamaiDenial } from "./waf-retry-policy.js";

const WAF_EXTRA_WAIT_MS = Number.parseInt(
  process.env.CLEARBOLT_BROWSER_WAF_WAIT_MS ?? "8000",
  10,
);
const WAF_MIN_HTML_CHARS = Number.parseInt(
  process.env.CLEARBOLT_BROWSER_MIN_HTML_CHARS ?? "5000",
  10,
);
/** Max wait for listing anchors on catalog/search (returns early when found). */
const LISTING_LINK_WAIT_MS = Number.parseInt(
  process.env.CLEARBOLT_BROWSER_LISTING_LINK_WAIT_MS ?? "20000",
  10,
);
const CATALOG_PAGINATION_WAIT_MS = Number.parseInt(
  process.env.CLEARBOLT_BROWSER_CATALOG_PAGINATION_WAIT_MS ?? "10000",
  10,
);
/** Extra wait for DataDome / captcha-delivery to resolve before snapshot. */
const DATADOME_RESOLVE_WAIT_MS = Number.parseInt(
  process.env.CLEARBOLT_BROWSER_DATADOME_WAIT_MS ?? "45000",
  10,
);
const BROWSER_USER_AGENT =
  process.env.CLEARBOLT_SCRAPER_USER_AGENT?.trim() ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** ngx-pagination often renders after listing cards (needed for discoverNext). */
const CATALOG_PAGINATION_SELECTOR =
  ".ngx-pagination a[href], a.bbsPager_next, li.pagination-next a[href]";

/** Sentinel response when the headed Playwright window is closed mid-fetch. */
function makeBrowserClosedResponse(url: string): RawResponse {
  return {
    status: 0,
    body: "",
    finalUrl: url,
    headers: {},
  };
}

/**
 * Dump the rendered HTML when a browser fetch returns 0 listing anchors —
 * the only way to tell a real-but-empty page from a WAF interstitial that
 * happens to return 200. Gated by `CLEARBOLT_BROWSER_DUMP_EMPTY=1`; writes
 * to `CLEARBOLT_BROWSER_DUMP_DIR` (default `data/debug/browser`).
 */
async function maybeDumpEmptyPage(args: {
  url: string;
  finalUrl: string;
  status: number;
  body: string;
  driver: BrowserDriverId;
}): Promise<void> {
  if (process.env.CLEARBOLT_BROWSER_DUMP_EMPTY !== "1") return;
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const root =
      process.env.CLEARBOLT_BROWSER_DUMP_DIR?.trim() ||
      `${process.env.DATA_DIR?.trim() || `${process.cwd()}/data`}/debug/browser`;
    await mkdir(root, { recursive: true });
    const host = (() => {
      try {
        return new URL(args.url).hostname;
      } catch {
        return "unknown";
      }
    })();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(root, `${host}-${args.driver}-${stamp}`);
    await writeFile(`${base}.html`, args.body, "utf8");
    await writeFile(
      `${base}.meta.json`,
      JSON.stringify(
        {
          requestUrl: args.url,
          finalUrl: args.finalUrl,
          status: args.status,
          driver: args.driver,
          bodyLength: args.body.length,
          titleMatch:
            /<title[^>]*>([^<]+)<\/title>/i.exec(args.body)?.[1]?.trim() ??
            null,
          firstChars: args.body.slice(0, 600),
          akamaiHints:
            /access denied|akamai|bm-verify|reference id|pardon our interruption/i.test(
              args.body.slice(0, 12_000),
            ),
        },
        null,
        2,
      ),
      "utf8",
    );
    scraperLog(`empty-page dump written: ${base}.html`);
  } catch (err) {
    scraperLog(
      `empty-page dump failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function isBrowserClosedError(message: string): boolean {
  return /Target page, context or browser has been closed|Browser has been closed/i.test(
    message,
  );
}

/** Tiny randomized mouse motion before snapshot — Akamai sensor rewards motion. */
async function jitterMouse(page: {
  mouse: {
    move: (x: number, y: number, opts?: { steps?: number }) => Promise<void>;
  };
}): Promise<void> {
  const r = (max: number) => Math.floor(Math.random() * max);
  await page.mouse.move(r(800) + 80, r(400) + 80, { steps: 5 });
  await page.mouse.move(r(600) + 100, r(500) + 100, { steps: 5 });
}

/**
 * Stealth init script: patches the common Playwright/Chromium fingerprint tells
 * Akamai / DataDome / Cloudflare score against. Runs before any page script.
 * Authored as a string because it runs in the browser context (no DOM lib in
 * scraper tsconfig). Not a substitute for patchright/rebrowser when the WAF
 * is aggressive — but defeats the cheapest checks.
 */
const STEALTH_INIT_SCRIPT = `(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  } catch (e) {}
  try {
    const fakePlugin = (name, filename) => ({
      name, filename, description: '', length: 1,
    });
    const plugins = [
      fakePlugin('PDF Viewer', 'internal-pdf-viewer'),
      fakePlugin('Chrome PDF Viewer', 'internal-pdf-viewer'),
      fakePlugin('Chromium PDF Viewer', 'internal-pdf-viewer'),
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => plugins,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [{ type: 'application/pdf', suffixes: 'pdf' }],
      configurable: true,
    });
  } catch (e) {}
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const orig = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : orig(params);
    }
  } catch (e) {}
  try {
    if (!window.chrome) window.chrome = { runtime: {}, app: {} };
  } catch (e) {}
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  } catch (e) {}
})();`;

export type BrowserSessionOptions = {
  /** Sticky residential/datacenter session (proxy username suffix). */
  sessionKey?: string;
  /** Host used to pick proxy tier when launching (defaults to first fetch). */
  proxyHostHint?: string;
  /** `false` = visible browser window (headed). */
  headless?: boolean;
  /**
   * Force a specific browser driver (`playwright` or `patchright`).
   * Defaults to `CLEARBOLT_BROWSER_DRIVER` (default `playwright`).
   */
  driver?: BrowserDriverId;
};

export type BrowserDriverId = "playwright" | "patchright";

function resolveBrowserDriver(options: BrowserSessionOptions): BrowserDriverId {
  if (options.driver) return options.driver;
  const raw = process.env.CLEARBOLT_BROWSER_DRIVER?.trim().toLowerCase();
  if (raw === "patchright") return "patchright";
  return "playwright";
}

function resolveSlowMo(headless: boolean): number {
  const raw = process.env.CLEARBOLT_BROWSER_SLOW_MO?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) return n;
  }
  return headless ? 0 : 100;
}

function scraperLog(message: string): void {
  if (
    process.env.CLEARBOLT_SCRAPER_DEBUG === "1" ||
    process.env.CLEARBOLT_BROWSER_HEADLESS === "0" ||
    process.env.CLEARBOLT_BROWSER_HEADED === "1"
  ) {
    console.error(`[scraper] ${message}`);
  }
}

export type BrowserSession = {
  fetcher: Fetcher;
  proxyTier: ProxyTier;
  close: () => Promise<void>;
};

function envHeadlessOverride(): boolean | undefined {
  const raw = process.env.CLEARBOLT_BROWSER_HEADLESS?.trim();
  if (raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  return undefined;
}

/**
 * Patchright benefits from a **stable** Chrome profile across runs (Akamai
 * warms up trust over time). The proxy session key, by contrast, rotates on a
 * wall-clock window so Decodo sticky sessions don't expire mid-run. Binding
 * the profile dir to the proxy key would force a cold relaunch every ~9 min
 * — exactly when we don't want one. Use a stable "profile slot" instead:
 *   - explicit `CLEARBOLT_BROWSER_PROFILE_DIR` wins
 *   - else `CLEARBOLT_BROWSER_PROFILE_SLOT` (default `default`)
 *   - else `CLEARBOLT_PROXY_SESSION_ID` (the base, without the time generation)
 */
function patchrightProfileDir(): string {
  const explicit = process.env.CLEARBOLT_BROWSER_PROFILE_DIR?.trim();
  if (explicit) return explicit;
  const root = process.env.DATA_DIR?.trim() || `${process.cwd()}/data`;
  const slotRaw =
    process.env.CLEARBOLT_BROWSER_PROFILE_SLOT?.trim() ||
    process.env.CLEARBOLT_PROXY_SESSION_ID?.trim() ||
    "default";
  const slot = slotRaw.replace(/[^a-z0-9_-]+/gi, "-");
  return `${root}/browser-profiles/patchright-${slot}`;
}

type PlaywrightChromium = typeof import("playwright")["chromium"];

type PersistentContext = Awaited<
  ReturnType<PlaywrightChromium["launchPersistentContext"]>
>;

type LaunchResult = {
  context: PersistentContext;
  close: () => Promise<void>;
  headless: boolean;
  slowMo?: number;
};

async function launchPlaywrightContext(args: {
  proxy: ReturnType<typeof playwrightProxyOptions>;
  explicitHeadless: boolean | undefined;
  hintHost: string;
  tier: ProxyTier;
}): Promise<LaunchResult> {
  const pw = await import("playwright");
  const headless = args.explicitHeadless ?? true;
  const slowMo = resolveSlowMo(headless);
  const launchOpts: Parameters<typeof pw.chromium.launch>[0] = {
    headless,
    slowMo,
    args: ["--disable-blink-features=AutomationControlled"],
    ...(args.proxy ? { proxy: args.proxy } : {}),
  };
  const useBundled = preferBundledChromiumForProxy();
  let browser: Awaited<ReturnType<typeof pw.chromium.launch>>;
  if (useBundled) {
    browser = await pw.chromium.launch(launchOpts);
    scraperLog(
      "using Playwright Chromium (bundled; blocks extension traffic via proxy)",
    );
  } else {
    try {
      browser = await pw.chromium.launch({ ...launchOpts, channel: "chrome" });
      scraperLog("using system Chrome (channel=chrome)");
    } catch {
      browser = await pw.chromium.launch(launchOpts);
    }
  }
  const context = (await browser.newContext({
    userAgent: BROWSER_USER_AGENT,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    extraHTTPHeaders: {
      "accept-language": "en-US,en;q=0.9",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
  })) as unknown as PersistentContext;
  return {
    context,
    headless,
    slowMo,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

async function launchPatchrightContext(args: {
  proxy: ReturnType<typeof playwrightProxyOptions>;
  explicitHeadless: boolean | undefined;
  hintHost: string;
}): Promise<LaunchResult | null> {
  let mod: typeof import("playwright");
  try {
    /**
     * Indirect specifier keeps patchright out of TS module resolution so it
     * stays a true optional dep — no type/install required to build.
     */
    const specifier = "patchright";
    const dynImport = new Function("s", "return import(s);") as (
      s: string,
    ) => Promise<unknown>;
    mod = (await dynImport(specifier)) as typeof import("playwright");
  } catch {
    return null;
  }
  /**
   * Patchright docs are explicit: for max stealth, use launchPersistentContext
   * with channel=chrome, headless=false, viewport=null, and do NOT set custom
   * userAgent or extraHTTPHeaders. We honor those defaults but still allow
   * `CLEARBOLT_BROWSER_HEADLESS=1` if the caller insists.
   * https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs
   */
  const headless = args.explicitHeadless ?? false;
  if (headless) {
    scraperLog(
      "patchright: headless=true requested — stealth is weaker; consider headless=0 / --headed",
    );
  }
  const profileDir = patchrightProfileDir();
  const launchOpts: Record<string, unknown> = {
    channel: "chrome",
    headless,
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled"],
    ...(args.proxy ? { proxy: args.proxy } : {}),
  };
  scraperLog(`patchright persistent profile dir: ${profileDir}`);
  const context = (await mod.chromium.launchPersistentContext(
    profileDir,
    launchOpts as Parameters<typeof mod.chromium.launchPersistentContext>[1],
  )) as PersistentContext;
  return {
    context,
    headless,
    close: async () => {
      await context.close();
    },
  };
}

/**
 * One Chromium process for many fetches (CLI scrape). Call `close()` when done.
 * Returns null when Playwright is missing, `CLEARBOLT_SKIP_BROWSER=1`, or import fails.
 */
export async function openBrowserSession(
  options: BrowserSessionOptions = {},
): Promise<BrowserSession | null> {
  if (process.env.CLEARBOLT_SKIP_BROWSER === "1") return null;

  primeBizBuySellResidentialHosts();
  const hintHost = options.proxyHostHint ?? "www.bizbuysell.com";
  markHostUseResidential(hintHost);

  const driver = resolveBrowserDriver(options);

  try {
    const tier = proxyTierForHost(hintHost, options.sessionKey);
    const proxy = playwrightProxyOptions(tier, options.sessionKey);
    const explicitHeadless = options.headless ?? envHeadlessOverride();
    const block3p =
      process.env.CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY?.trim() !== "0";

    let context: Awaited<
      ReturnType<typeof import("playwright").chromium.launchPersistentContext>
    >;
    let closeAll: () => Promise<void>;

    if (driver === "patchright") {
      const result = await launchPatchrightContext({
        proxy,
        explicitHeadless,
        hintHost,
      });
      if (!result) {
        scraperLog(
          "patchright requested but not installed; run `pnpm add patchright -F @clearbolt/scraper && npx patchright install chrome`",
        );
        return null;
      }
      context = result.context;
      closeAll = result.close;
      scraperLog(
        `patchright launch tier=${tier} proxy=${proxy ? "on" : "off"} host=${hintHost} headless=${result.headless} channel=chrome persistent=on${block3p ? " block3p=on" : ""}`,
      );
    } else {
      const result = await launchPlaywrightContext({
        proxy,
        explicitHeadless,
        hintHost,
        tier,
      });
      context = result.context;
      closeAll = result.close;
      scraperLog(
        `Playwright launch mode=${result.headless ? "headless" : "headed"} tier=${tier} proxy=${proxy ? "on" : "off"} host=${hintHost}${result.slowMo ? ` slowMo=${result.slowMo}ms` : ""}${block3p ? " block3p=on" : ""}`,
      );
    }

    /** Compound stealth init runs after patchright's own patches; harmless overlap. */
    await context.addInitScript({ content: STEALTH_INIT_SCRIPT });
    await installBrowserResourceBlocking(context);

    const fetcher: Fetcher = {
      async fetch(req: FetchRequest): Promise<RawResponse> {
        const page = await context.newPage();
        const listingDetail = isBizBuySellListingUrl(req.url);
        try {
          scraperLog(`goto ${req.url}`);
          let resp: Awaited<ReturnType<typeof page.goto>> | null = null;
          try {
            resp = await page.goto(req.url, {
              waitUntil: "domcontentloaded",
              timeout: 90_000,
            });
          } catch (navErr) {
            const msg =
              navErr instanceof Error ? navErr.message : String(navErr);
            if (isBrowserClosedError(msg)) {
              return makeBrowserClosedResponse(req.url);
            }
            if (!/ERR_HTTP_RESPONSE_CODE_FAILURE|net::ERR_/i.test(msg)) {
              throw navErr;
            }
            scraperLog(
              `goto HTTP error (${msg}); continuing with page content if present`,
            );
          }
          try {
            await jitterMouse(page);
          } catch {
            /* ignore */
          }
          const listingLinkSelector = listingLinkSelectorForUrl(req.url);
          if (!listingDetail && LISTING_LINK_WAIT_MS > 0) {
            scraperLog(
              `loaded status=${resp?.status() ?? "?"} url=${page.url()} — waiting for listing links (up to ${LISTING_LINK_WAIT_MS}ms)…`,
            );
            try {
              await page.waitForSelector(listingLinkSelector, {
                timeout: LISTING_LINK_WAIT_MS,
              });
              scraperLog("listing links visible");
            } catch {
              scraperLog(
                "listing link selector timed out (challenge or slow page)",
              );
            }
          }
          if (
            isBizBuySellCatalogUrl(req.url) &&
            CATALOG_PAGINATION_WAIT_MS > 0
          ) {
            try {
              await page.waitForSelector(CATALOG_PAGINATION_SELECTOR, {
                timeout: CATALOG_PAGINATION_WAIT_MS,
              });
              scraperLog("catalog pagination visible");
            } catch {
              scraperLog(
                "pagination selector timed out (will try HTML inference)",
              );
            }
          }
          const wafWaitMs = listingDetail
            ? Math.min(WAF_EXTRA_WAIT_MS, 5_000)
            : WAF_EXTRA_WAIT_MS;
          if (wafWaitMs > 0) {
            scraperLog(`extra wait ${wafWaitMs}ms for Akamai…`);
            try {
              await page.waitForTimeout(wafWaitMs);
            } catch (waitErr) {
              const m =
                waitErr instanceof Error ? waitErr.message : String(waitErr);
              if (isBrowserClosedError(m)) {
                return makeBrowserClosedResponse(req.url);
              }
              throw waitErr;
            }
          }
          let status = resp?.status() ?? (resp === null ? 403 : 200);
          let body: string;
          try {
            body = await page.content();
          } catch (contentErr) {
            const m =
              contentErr instanceof Error
                ? contentErr.message
                : String(contentErr);
            if (isBrowserClosedError(m)) {
              return makeBrowserClosedResponse(req.url);
            }
            throw contentErr;
          }
          if (
            !listingDetail &&
            DATADOME_RESOLVE_WAIT_MS > 0 &&
            /captcha-delivery/i.test(body.slice(0, 8_000))
          ) {
            scraperLog(
              `DataDome challenge detected — waiting up to ${DATADOME_RESOLVE_WAIT_MS}ms for listings…`,
            );
            try {
              await page.waitForSelector(listingLinkSelector, {
                timeout: DATADOME_RESOLVE_WAIT_MS,
              });
              scraperLog("listing links visible after DataDome wait");
            } catch {
              scraperLog("DataDome wait timed out");
            }
            body = await page.content();
          }
          const thin = () => body.length < WAF_MIN_HTML_CHARS;
          const looksBlocked = () =>
            thin() &&
            (status === 401 ||
              status === 403 ||
              /akamai|access denied|captcha|bm-verify/i.test(
                body.slice(0, 12_000),
              ));
          if (looksBlocked() && !isHardAkamaiDenial(body)) {
            await page.waitForTimeout(wafWaitMs);
            const reload = await page.reload({
              waitUntil: "domcontentloaded",
            });
            status = reload?.status() ?? status;
            if (!listingDetail && LISTING_LINK_WAIT_MS > 0) {
              try {
                await page.waitForSelector(listingLinkSelector, {
                  timeout: LISTING_LINK_WAIT_MS,
                });
              } catch {
                /* keep going */
              }
            }
            body = await page.content();
          }
          const finalUrl = page.url();
          if (!listingDetail) {
            const hasListingAnchor = new RegExp(
              listingLinkSelector
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => {
                  const m = /href\*?=["']([^"']+)["']/.exec(s);
                  return m
                    ? m[1]?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                    : null;
                })
                .filter((s): s is string => !!s)
                .join("|") || "__never__",
              "i",
            ).test(body);
            if (!hasListingAnchor) {
              await maybeDumpEmptyPage({
                url: req.url,
                finalUrl,
                status,
                body,
                driver,
              });
            }
          }
          return {
            status,
            body,
            finalUrl,
            headers: {},
          };
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (isBrowserClosedError(m)) {
            return makeBrowserClosedResponse(req.url);
          }
          throw err;
        } finally {
          try {
            await page.close();
          } catch {
            /* page may already be gone */
          }
        }
      },
    };
    return {
      fetcher,
      proxyTier: tier,
      close: closeAll,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[scraper] Playwright failed to start: ${msg}. Run: pnpm ensure:playwright`,
    );
    return null;
  }
}
