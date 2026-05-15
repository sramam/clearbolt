import type { WafClass } from "./waf-detector.js";

export type HttpLanePlan =
  | { kind: "ok" }
  | { kind: "retry_http" }
  | { kind: "persist_needs_browser" };

/**
 * Decide the next step for the HTTP fetch lane after WAF classification.
 * Stops infinite retry: challenge/block persist `needsBrowser` immediately;
 * rate limits retry up to `maxHttpAttempts` responses then persist.
 */
export function planHttpLaneAfterWaf(
  waf: WafClass,
  opts: { httpAttemptIndex: number; maxHttpAttempts: number },
): HttpLanePlan {
  const { httpAttemptIndex, maxHttpAttempts } = opts;
  if (waf === "ok") return { kind: "ok" };

  if (waf === "rate_limited") {
    if (httpAttemptIndex < maxHttpAttempts - 1) return { kind: "retry_http" };
    return { kind: "persist_needs_browser" };
  }

  return { kind: "persist_needs_browser" };
}
