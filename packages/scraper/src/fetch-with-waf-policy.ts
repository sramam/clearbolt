import type { RawResponse } from "@clearbolt/core";
import { planHttpLaneAfterWaf } from "./crawl-policy.js";
import type { Fetcher } from "./fetcher.js";
import { throttleHost } from "./throttle.js";
import { classifyWaf } from "./waf-detector.js";

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
export async function fetchHtmlWithHttpWafPolicy(
  fetcher: Fetcher,
  url: string,
  options: FetchHtmlWithHttpWafPolicyOptions,
): Promise<RawResponse> {
  const host = new URL(url).hostname;
  if (options.hostRequiresBrowser) {
    const browser = await options.hostRequiresBrowser(host);
    if (browser) {
      if (!options.browserFetcher) throw browserLaneUnavailable(host, url);
      return options.browserFetcher.fetch({ url });
    }
  }
  const maxHttpAttempts = options.maxHttpAttempts ?? 3;
  const throttleMs = options.throttleMsBetweenRetries ?? 75;
  let attempt = 0;
  let res = await fetcher.fetch({ url });
  for (;;) {
    const waf = classifyWaf(res.status, res.body);
    const plan = planHttpLaneAfterWaf(waf, {
      httpAttemptIndex: attempt,
      maxHttpAttempts,
    });
    if (plan.kind === "ok") return res;
    if (plan.kind === "retry_http") {
      attempt++;
      await throttleHost(host, throttleMs);
      res = await fetcher.fetch({ url });
      continue;
    }
    await options.persistNeedsBrowser(host);
    if (options.browserFetcher) {
      return options.browserFetcher.fetch({ url });
    }
    throw new Error(
      `WAF ${waf} on HTTP lane for ${url} (attempt ${attempt}); needsBrowser=true stored for ${host}`,
    );
  }
}
