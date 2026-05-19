import type { WafClass } from "./waf-detector.js";
import { classifyWaf } from "./waf-detector.js";

/** Default cap for HTTP + browser WAF retries (`CLEARBOLT_WAF_MAX_ATTEMPTS`, default 3). */
export function resolveWafMaxAttempts(explicit?: number): number {
  if (explicit !== undefined && explicit > 0) {
    return Math.max(1, Math.min(explicit, 10));
  }
  const raw = process.env.CLEARBOLT_WAF_MAX_ATTEMPTS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isNaN(n) && n > 0) return Math.max(1, Math.min(n, 10));
  return 3;
}

/**
 * Akamai hard denial (Access Denied + edgesuite reference). Retrying the same
 * proxy/browser session rarely helps.
 */
export function isHardAkamaiDenial(body: string): boolean {
  const sample = body.slice(0, 20_000).toLowerCase();
  if (!sample.includes("access denied")) return false;
  return (
    sample.includes("edgesuite.net") ||
    sample.includes("you don't have permission to access") ||
    sample.includes("you dont have permission to access") ||
    /reference\s*#\s*[\d.a-f]+/i.test(body.slice(0, 4_000))
  );
}

export function hardAkamaiDenialMessage(url: string): string {
  return `Akamai hard block (not retriable on this session) for ${url}`;
}

/** Immediate re-fetch attempts after `rotateSession()` on a rotating proxy worker (default 1). */
export function akamaiHardBlockProxyRetryAttempts(): number {
  const raw = process.env.CLEARBOLT_AKAMAI_HARD_BLOCK_PROXY_RETRY?.trim();
  if (raw === "0") return 0;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isNaN(n) && n >= 0) return Math.min(n, 3);
  return 1;
}

export type HttpLanePlan =
  | { kind: "ok" }
  | { kind: "retry_http" }
  | { kind: "persist_needs_browser" }
  | { kind: "fail_hard" };

export function planHttpLaneAfterWafResponse(
  status: number,
  body: string,
  opts: { httpAttemptIndex: number; maxHttpAttempts: number },
): HttpLanePlan {
  if (isHardAkamaiDenial(body)) return { kind: "fail_hard" };
  return planHttpLaneAfterWaf(classifyWaf(status, body), opts);
}

/** @deprecated Prefer {@link planHttpLaneAfterWafResponse} with body for hard-block detection. */
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

  /** challenge / block: escalate to browser (or fail) without more HTTP tries */
  return { kind: "persist_needs_browser" };
}

/** Whether the browser lane should issue another fetch for this response. */
export function shouldRetryBrowserWafFetch(
  status: number,
  body: string,
  attemptIndex: number,
  maxAttempts: number,
): boolean {
  if (isHardAkamaiDenial(body)) return false;
  const waf = classifyWaf(status, body);
  if (waf === "ok") return false;
  return attemptIndex < maxAttempts - 1;
}
