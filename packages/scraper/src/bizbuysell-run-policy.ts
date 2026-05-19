import type { ListingRef } from "@clearbolt/core";
import { discoverBizBuySellListingRefsFromSerper } from "./bizbuysell-serper-discovery.js";
import type { FetchHtmlWithHttpWafPolicyOptions } from "./fetch-with-waf-policy.js";
import { resolveWafMaxAttempts } from "./waf-retry-policy.js";
import {
  markHostUseResidential,
  residentialProxyConfigured,
  residentialProxyEndpointCount,
} from "./proxy-config.js";
import { serperApiKeyFromEnv } from "./serper-client.js";

export type BizBuySellDiscoveryMode =
  | "direct"
  | "serper"
  | "fixtures"
  | "direct+serper";

const BIZBUYSELL_HOSTS = ["www.bizbuysell.com", "m.bizbuysell.com"] as const;

/** Primary discovery is always direct HTML unless explicitly overridden. */
export function resolveBizBuySellDiscoveryMode(options: {
  useFixtures?: boolean;
  discovery?: "direct" | "serper" | "fixtures";
}): Exclude<BizBuySellDiscoveryMode, "direct+serper"> {
  if (options.useFixtures) return "fixtures";
  if (options.discovery) return options.discovery;
  const forced = process.env.CLEARBOLT_BIZBUYSELL_DISCOVERY?.trim();
  if (forced === "direct" || forced === "serper" || forced === "fixtures") {
    return forced;
  }
  return "direct";
}

export function serperSupplementEnabled(): boolean {
  if (process.env.CLEARBOLT_BIZBUYSELL_SERPER_SUPPLEMENT === "0") return false;
  return Boolean(serperApiKeyFromEnv());
}

/**
 * Playwright-first is opt-in (`CLEARBOLT_BIZBUYSELL_BROWSER_FIRST=1`).
 * Default with Decodo: HTTP through residential proxy, then Playwright on WAF failure
 * (headless Chromium often gets 403 even on residential IPs).
 */
export function shouldUseBrowserFirstForBizBuySell(): boolean {
  return process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST?.trim() === "1";
}

/** Use m.bizbuysell.com for fetches when www is blocked (proxy / Playwright paths). */
export function shouldPreferMobileBizBuySellFetch(): boolean {
  return (
    shouldUseBrowserFirstForBizBuySell() ||
    shouldUseHttpProxyFirstForBizBuySell() ||
    residentialProxyConfigured()
  );
}

/**
 * Listing detail host. Default: same as {@link shouldPreferMobileBizBuySellFetch}.
 * `CLEARBOLT_BIZBUYSELL_LISTING_PREFER_MOBILE=0` keeps www; `=1` forces m.
 * On m. failure (Akamai/WAF), www is retried unless `LISTING_DESKTOP_FALLBACK=0`.
 */
export function shouldPreferMobileBizBuySellListing(): boolean {
  const forced = process.env.CLEARBOLT_BIZBUYSELL_LISTING_PREFER_MOBILE?.trim();
  if (forced === "0") return false;
  if (forced === "1") return true;
  return shouldPreferMobileBizBuySellFetch();
}

/** Retry listing fetch on www after m. hard-block / WAF (some listings are www-only). */
export function shouldRetryBizBuySellListingOnDesktop(err: unknown): boolean {
  if (process.env.CLEARBOLT_BIZBUYSELL_LISTING_DESKTOP_FALLBACK?.trim() === "0") {
    return false;
  }
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("hard block") ||
    m.includes("akamai") ||
    m.includes("waf") ||
    m.includes("needsbrowser") ||
    m.includes("thin html") ||
    m.includes("access denied")
  );
}

/**
 * Catalog discovery host. Set `CLEARBOLT_BIZBUYSELL_PREFER_MOBILE=0` to stay on www
 * when your proxy can fetch the desktop catalog without Akamai blocks.
 */
export function shouldPreferMobileBizBuySellCatalog(): boolean {
  if (process.env.CLEARBOLT_BIZBUYSELL_PREFER_MOBILE?.trim() === "0") {
    return false;
  }
  return shouldPreferMobileBizBuySellFetch();
}

/** HTTP fetcher + residential proxy before opening Playwright. */
export function shouldUseHttpProxyFirstForBizBuySell(): boolean {
  if (process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST?.trim() === "1") {
    return false;
  }
  return residentialProxyConfigured();
}

/**
 * Paginated catalog discovery should stay on HTTP+proxy (no Playwright escalation).
 * Browser fallback on page 2+ often hangs and costs far more than retrying HTTP.
 */
export function shouldKeepCatalogDiscoveryOnHttpLane(): boolean {
  return (
    shouldUseHttpProxyFirstForBizBuySell() &&
    !shouldUseBrowserFirstForBizBuySell()
  );
}

/** Route residential proxy for BizBuySell hosts before the first fetch. */
export function primeBizBuySellResidentialHosts(): void {
  if (!residentialProxyConfigured()) return;
  for (const host of BIZBUYSELL_HOSTS) {
    markHostUseResidential(host);
  }
}

/**
 * Playwright fallback when HTTP listing ingest hits WAF (opt-out:
 * `CLEARBOLT_BIZBUYSELL_INGEST_BROWSER_FALLBACK=0`).
 */
export function shouldUseBrowserFallbackForBizBuySellListingIngest(): boolean {
  return (
    process.env.CLEARBOLT_BIZBUYSELL_INGEST_BROWSER_FALLBACK?.trim() !== "0"
  );
}

/** WAF policy for catalog index pages when staying on the HTTP+proxy lane. */
export function catalogDiscoveryWafPolicy(
  base: FetchHtmlWithHttpWafPolicyOptions,
): FetchHtmlWithHttpWafPolicyOptions {
  const httpOnly = shouldKeepCatalogDiscoveryOnHttpLane();
  const ignoreStaleNeedsBrowser =
    httpOnly || residentialProxyConfigured() || shouldUseBrowserFirstForBizBuySell();
  if (!ignoreStaleNeedsBrowser) return base;
  return {
    ...base,
    ...(httpOnly ? { browserFetcher: undefined } : {}),
    /** Prior runs may have set needsBrowser; catalog index should not force browser without a session. */
    hostRequiresBrowser: async () => false,
    maxHttpAttempts: resolveWafMaxAttempts(base.maxHttpAttempts),
    throttleMsBetweenRetries: httpOnly ? 2500 : 4000,
    persistNeedsBrowser: async () => {
      /* avoid marking m./www. browser-only mid-pagination */
    },
  };
}

/**
 * Listing detail: HTTP+proxy first, but keep `browserFetcher` for WAF escalation
 * (unlike catalog pagination, which stays HTTP-only).
 */
export function listingIngestWafPolicy(
  base: FetchHtmlWithHttpWafPolicyOptions,
): FetchHtmlWithHttpWafPolicyOptions {
  if (
    shouldUseBrowserFirstForBizBuySell() &&
    !shouldPreferHttpIngestForBizBuySell()
  ) {
    return base;
  }

  const httpOnly = shouldKeepCatalogDiscoveryOnHttpLane();
  const canEscalateToBrowser =
    Boolean(base.browserFetcher) &&
    shouldUseBrowserFallbackForBizBuySellListingIngest();

  return {
    ...base,
    browserLanePrimary: false,
    hostRequiresBrowser: async () => false,
    maxHttpAttempts: resolveWafMaxAttempts(base.maxHttpAttempts),
    throttleMsBetweenRetries:
      base.throttleMsBetweenRetries ?? (httpOnly ? 2500 : 4000),
    persistNeedsBrowser: canEscalateToBrowser
      ? base.persistNeedsBrowser
      : async () => {
          /* HTTP-only ingest: no metadata flip */
        },
  };
}

export function catalogPageGapMs(): number {
  const n = Number.parseInt(
    process.env.CLEARBOLT_CATALOG_PAGE_GAP_MS ?? "2000",
    10,
  );
  return Number.isNaN(n) ? 2000 : Math.max(0, n);
}

/**
 * Listing ingest over HTTP+rotating Decodo sessions (parallel ports).
 * Default on when multiple proxy endpoints are configured.
 */
export function shouldPreferHttpIngestForBizBuySell(): boolean {
  const forced = process.env.CLEARBOLT_BIZBUYSELL_INGEST_HTTP?.trim();
  if (forced === "1") return true;
  if (forced === "0") return false;
  /** Multi-port file → HTTP ingest (one worker per line); discovery may still use Playwright. */
  return residentialProxyEndpointCount() > 1;
}

/** Default cap when many proxy ports are configured (avoids 50-way Akamai bursts). */
export function defaultHttpIngestWorkerCap(): number {
  const raw = process.env.CLEARBOLT_HTTP_INGEST_WORKER_CAP?.trim();
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 12;
}

/**
 * Parallel listing ingests: one worker per `CLEARBOLT_PROXY_ENDPOINTS_FILE` line
 * when using rotating HTTP (capped by `defaultHttpIngestWorkerCap()` unless
 * `CLEARBOLT_SCRAPE_CONCURRENCY` is set).
 */
export function resolveListingIngestConcurrency(options?: {
  explicit?: number;
  useRotatingHttpWorkers?: boolean;
}): number {
  const proxyPorts = residentialProxyEndpointCount();
  const useHttp =
    options?.useRotatingHttpWorkers ?? shouldPreferHttpIngestForBizBuySell();

  if (proxyPorts > 0 && useHttp) {
    const fromEnv = process.env.CLEARBOLT_SCRAPE_CONCURRENCY?.trim();
    const envN =
      fromEnv !== undefined && fromEnv !== ""
        ? Number.parseInt(fromEnv, 10)
        : Number.NaN;
    if (!Number.isNaN(envN) && envN > 0) {
      return Math.max(1, Math.min(envN, proxyPorts));
    }
    if (options?.explicit !== undefined && options.explicit > 0) {
      return Math.max(1, Math.min(options.explicit, proxyPorts));
    }
    return Math.max(1, Math.min(proxyPorts, defaultHttpIngestWorkerCap()));
  }

  const fromEnv = process.env.CLEARBOLT_SCRAPE_CONCURRENCY?.trim();
  const envN =
    fromEnv !== undefined && fromEnv !== ""
      ? Number.parseInt(fromEnv, 10)
      : Number.NaN;
  if (!Number.isNaN(envN) && envN > 0) return envN;
  if (options?.explicit !== undefined && options.explicit > 0) {
    return options.explicit;
  }
  if (shouldUseBrowserFirstForBizBuySell()) return 2;
  if (shouldPreferMobileBizBuySellFetch()) return 4;
  return 4;
}

/**
 * Playwright sessions for HTTP→browser WAF fallback. Capped separately from HTTP
 * concurrency so 50 proxy ports does not launch 50 Chromium processes.
 * `CLEARBOLT_BROWSER_FALLBACK_WORKERS` (default min(httpWorkers, 4)).
 */
export function resolveBrowserFallbackWorkerCount(httpWorkers: number): number {
  const cap = Math.max(1, httpWorkers);
  const fromEnv = process.env.CLEARBOLT_BROWSER_FALLBACK_WORKERS?.trim();
  const envN =
    fromEnv !== undefined && fromEnv !== ""
      ? Number.parseInt(fromEnv, 10)
      : Number.NaN;
  if (!Number.isNaN(envN) && envN > 0) {
    return Math.max(1, Math.min(envN, cap));
  }
  return Math.max(1, Math.min(cap, 4));
}

/** @deprecated Use {@link resolveListingIngestConcurrency}. */
export function listingIngestDefaultConcurrency(): number {
  return resolveListingIngestConcurrency();
}

/** Add Serper listing URLs not already found via direct/catalog discovery. */
export async function supplementListingRefsFromSerper(
  refs: ListingRef[],
  keywords: string,
  limit: number,
): Promise<{ refs: ListingRef[]; serperAdded: number }> {
  if (!serperSupplementEnabled() || !keywords.trim()) {
    return { refs, serperAdded: 0 };
  }
  const room = limit - refs.length;
  if (room <= 0) return { refs, serperAdded: 0 };

  const { refs: serperRefs } = await discoverBizBuySellListingRefsFromSerper(
    keywords,
    room,
  );
  const seen = new Set(refs.map((r) => r.url));
  let serperAdded = 0;
  const merged = [...refs];
  for (const ref of serperRefs) {
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    merged.push(ref);
    serperAdded++;
    if (merged.length >= limit) break;
  }
  return { refs: merged, serperAdded };
}
