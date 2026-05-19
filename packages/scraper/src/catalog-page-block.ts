import { isHardAkamaiDenial } from "./waf-retry-policy.js";

export type CatalogPageBlockReason =
  | "akamai_hard_denial"
  | "datadome_challenge"
  | "http_forbidden"
  | "thin_challenge_page";

export type CatalogPageBlockDetail = {
  blocked: true;
  reason: CatalogPageBlockReason;
  message: string;
};

export class CatalogPageBlockedError extends Error {
  readonly name = "CatalogPageBlockedError";
  constructor(
    message: string,
    readonly detail: CatalogPageBlockDetail,
    readonly pageUrl: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

export function describeCatalogPageBlock(
  detail: CatalogPageBlockDetail,
): string {
  return detail.message;
}

/**
 * True when catalog HTML is a WAF/challenge page, not an empty search result.
 */
export function detectCatalogPageBlock(
  status: number,
  html: string,
): CatalogPageBlockDetail | null {
  const sample = html.slice(0, 24_000);
  const lower = sample.toLowerCase();

  if (isHardAkamaiDenial(html)) {
    return {
      blocked: true,
      reason: "akamai_hard_denial",
      message:
        "Akamai blocked this catalog page (Access Denied). Rotate residential proxy session or retry later.",
    };
  }

  const datadomeRestricted =
    lower.includes("access is temporarily restricted") ||
    lower.includes("unusual activity from your device") ||
    (lower.includes("automated") &&
      lower.includes("bot") &&
      lower.includes("activity on your network"));

  if (
    datadomeRestricted ||
    lower.includes("captcha-delivery.com") ||
    lower.includes("geo.captcha-delivery.com") ||
    (lower.includes("please enable js") && lower.includes("ad blocker")) ||
    lower.includes("datadome")
  ) {
    return {
      blocked: true,
      reason: "datadome_challenge",
      message: datadomeRestricted
        ? "DataDome blocked this session (access temporarily restricted — proxy IP or automation flagged). Rotate CLEARBOLT_PROXY_SESSION_ID, try a fresh residential IP, or use a normal browser on the same network to confirm the catalog loads."
        : "DataDome challenge page (listing JS did not run). Ensure CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY allows captcha-delivery.com or retry with a fresh proxy session.",
    };
  }

  if (status === 403 || status === 401) {
    const title = lower.match(/<title[^>]*>([^<]{0,120})/)?.[1]?.trim() ?? "";
    if (
      title.includes("access denied") ||
      lower.includes("cf-browser-verification") ||
      lower.includes("just a moment")
    ) {
      return {
        blocked: true,
        reason: "http_forbidden",
        message: `HTTP ${status} challenge on catalog page (${title || "forbidden"}).`,
      };
    }
  }

  if (
    html.length < 2_000 &&
    (status === 403 ||
      status === 401 ||
      /captcha|challenge|verify you are human/i.test(sample))
  ) {
    return {
      blocked: true,
      reason: "thin_challenge_page",
      message: `Thin challenge response (${status}, ${html.length} bytes).`,
    };
  }

  return null;
}
