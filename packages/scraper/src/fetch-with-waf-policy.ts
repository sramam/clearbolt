import type { RawResponse } from "@clearbolt/core";
import {
  type CrawlGateOptions,
  beforeCrawlFetch,
} from "./crawl-gate.js";
import { planHttpLaneAfterWafResponse } from "./crawl-policy.js";
import type { Fetcher } from "./fetcher.js";
import {
  canEscalateHostToResidential,
  markHostUseResidential,
} from "./proxy-config.js";
import { isTransientNetworkError } from "./network-errors.js";
import { throttleHost } from "./throttle.js";
import { classifyWaf } from "./waf-detector.js";
import {
  hardAkamaiDenialMessage,
  isHardAkamaiDenial,
  resolveWafMaxAttempts,
  shouldRetryBrowserWafFetch,
} from "./waf-retry-policy.js";

export type PersistNeedsBrowserFn = (host: string) => Promise<void>;

export type FetchHtmlWithHttpWafPolicyOptions = {
  persistNeedsBrowser: PersistNeedsBrowserFn;
  /** HTTP attempts per URL before persisting needsBrowser (default 3). */
  maxHttpAttempts?: number;
  /** Gap between HTTP retries for the same host (default 75). */
  throttleMsBetweenRetries?: number;
  /**
   * When true, skip the HTTP lane entirely (no wasted retries). Callers
   * typically read `MetadataStore.getDomainProfile(host)?.needsBrowser`.
   */
  hostRequiresBrowser?: (host: string) => Promise<boolean>;
  /** Playwright-backed lane; used when host already needs browser or HTTP is exhausted. */
  browserFetcher?: Fetcher;
  /** robots.txt + minimum inter-request gap (default on; set CLEARBOLT_SCRAPER_ROBOTS=0 to disable). */
  crawlGate?: CrawlGateOptions | false;
  /** Sticky proxy session for catalog pagination / logged-in flows. */
  proxySessionKey?: string;
  /** Primary fetcher is already Playwright — use browser retries, not HTTP escalation. */
  browserLanePrimary?: boolean;
  /** Minimum HTML length to treat a browser response as success (default 5000). */
  wafMinHtmlChars?: number;
};

function browserLaneUnavailable(host: string, url: string): Error {
  return new Error(
    `Host ${host} requires the browser lane; install Playwright (optional dependency of @clearbolt/scraper) or set CLEARBOLT_SKIP_BROWSER=1 for HTTP-only runs. Target: ${url}`,
  );
}

/**
 * Bounded HTTP retries for HTML fetches: classify WAF, retry rate limits up to
 * `maxHttpAttempts`, then persist `needsBrowser` and either delegate to
 * `browserFetcher` or throw when it is missing.
 */
const DEFAULT_BROWSER_MIN_HTML = 5000;

function htmlLooksLikeBizBuySellCatalog(body: string): boolean {
  return /bizbuysell\.com\/[^"'\s>]*(business-for-sale|business-opportunity|-for-sale\/\d)/i.test(
    body,
  );
}

async function fetchHtmlWithBrowserPrimaryWafPolicy(
  fetcher: Fetcher,
  url: string,
  options: FetchHtmlWithHttpWafPolicyOptions,
): Promise<RawResponse> {
  const host = new URL(url).hostname;
  const crawlGate =
    options.crawlGate === false ? undefined : (options.crawlGate ?? {});
  const minChars = options.wafMinHtmlChars ?? DEFAULT_BROWSER_MIN_HTML;
  const maxAttempts = resolveWafMaxAttempts(options.maxHttpAttempts);
  const throttleMs = options.throttleMsBetweenRetries ?? 2000;

  const gatedFetch = async (targetUrl: string) => {
    if (crawlGate) await beforeCrawlFetch(targetUrl, crawlGate);
    return fetcher.fetch({ url: targetUrl });
  };

  let attempt = 0;
  let res = await gatedFetch(url);
  for (;;) {
    if (isHardAkamaiDenial(res.body)) {
      throw new Error(hardAkamaiDenialMessage(url));
    }
    const waf = classifyWaf(res.status, res.body);
    const thin = res.body.length < minChars;
    if (waf === "ok" && (!thin || htmlLooksLikeBizBuySellCatalog(res.body))) {
      return res;
    }
    if (
      !shouldRetryBrowserWafFetch(res.status, res.body, attempt, maxAttempts)
    ) {
      throw new Error(
        `WAF ${waf}${thin ? " (thin HTML)" : ""} on browser lane for ${url} after ${attempt + 1} attempt(s)`,
      );
    }
    attempt++;
    if (canEscalateHostToResidential(host)) markHostUseResidential(host);
    const delay =
      waf === "challenge" || waf === "block"
        ? throttleMs * (attempt + 1)
        : throttleMs;
    await throttleHost(host, delay);
    res = await gatedFetch(url);
  }
}

export async function fetchHtmlWithHttpWafPolicy(
  fetcher: Fetcher,
  url: string,
  options: FetchHtmlWithHttpWafPolicyOptions,
): Promise<RawResponse> {
  if (options.browserLanePrimary) {
    return fetchHtmlWithBrowserPrimaryWafPolicy(fetcher, url, options);
  }

  const host = new URL(url).hostname;
  const crawlGate =
    options.crawlGate === false ? undefined : (options.crawlGate ?? {});

  const gatedFetch = async (f: Fetcher, targetUrl: string) => {
    if (crawlGate) await beforeCrawlFetch(targetUrl, crawlGate);
    return f.fetch({ url: targetUrl });
  };

  const gatedFetchResilient = async (
    f: Fetcher,
    targetUrl: string,
    networkAttempts: number,
    networkThrottleMs: number,
  ): Promise<RawResponse> => {
    const targetHost = new URL(targetUrl).hostname;
    let lastErr: unknown;
    for (let i = 0; i < networkAttempts; i++) {
      try {
        return await gatedFetch(f, targetUrl);
      } catch (err) {
        lastErr = err;
        if (!isTransientNetworkError(err) || i >= networkAttempts - 1) {
          throw err;
        }
        await throttleHost(targetHost, networkThrottleMs);
      }
    }
    throw lastErr;
  };

  if (options.hostRequiresBrowser) {
    const browser = await options.hostRequiresBrowser(host);
    if (browser) {
      if (!options.browserFetcher) throw browserLaneUnavailable(host, url);
      return gatedFetch(options.browserFetcher, url);
    }
  }
  const maxHttpAttempts = resolveWafMaxAttempts(options.maxHttpAttempts);
  const throttleMs = options.throttleMsBetweenRetries ?? 75;
  let attempt = 0;
  let residentialHttpTried = false;
  let res = await gatedFetchResilient(
    fetcher,
    url,
    maxHttpAttempts,
    throttleMs,
  );
  for (;;) {
    const plan = planHttpLaneAfterWafResponse(res.status, res.body, {
      httpAttemptIndex: attempt,
      maxHttpAttempts,
    });
    if (plan.kind === "ok") return res;
    if (plan.kind === "fail_hard") {
      throw new Error(hardAkamaiDenialMessage(url));
    }
    const waf = classifyWaf(res.status, res.body);
    if (plan.kind === "retry_http") {
      attempt++;
      if (waf === "rate_limited" && canEscalateHostToResidential(host)) {
        markHostUseResidential(host);
      }
      await throttleHost(host, throttleMs);
      res = await gatedFetchResilient(
        fetcher,
        url,
        maxHttpAttempts,
        throttleMs,
      );
      continue;
    }
    if (
      !residentialHttpTried &&
      canEscalateHostToResidential(host) &&
      (waf === "block" || waf === "challenge" || waf === "rate_limited")
    ) {
      markHostUseResidential(host);
      residentialHttpTried = true;
      await throttleHost(host, throttleMs);
      res = await gatedFetchResilient(
        fetcher,
        url,
        maxHttpAttempts,
        throttleMs,
      );
      continue;
    }
    if (waf === "block" || waf === "challenge") {
      markHostUseResidential(host);
    }
    await options.persistNeedsBrowser(host);
    if (options.browserFetcher && !isHardAkamaiDenial(res.body)) {
      return fetchHtmlWithBrowserPrimaryWafPolicy(
        options.browserFetcher,
        url,
        {
          ...options,
          browserLanePrimary: true,
          browserFetcher: undefined,
        },
      );
    }
    throw new Error(
      `WAF ${waf} on HTTP lane for ${url} (attempt ${attempt}); needsBrowser=true stored for ${host}`,
    );
  }
}
