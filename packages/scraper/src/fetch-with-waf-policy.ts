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
};

/**
 * Bounded HTTP retries for HTML fetches: classify WAF, retry rate limits up to
 * `maxHttpAttempts`, then persist `needsBrowser` via `persistNeedsBrowser` and throw.
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
      throw new Error(
        `Host ${host} requires the browser lane (needsBrowser); HTTP-only fetch skipped for ${url}`,
      );
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
    throw new Error(
      `WAF ${waf} on HTTP lane for ${url} (attempt ${attempt}); needsBrowser=true stored for ${host}`,
    );
  }
}
