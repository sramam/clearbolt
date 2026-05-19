import { residentialProxyConfigured } from "./proxy-config.js";

/** Hosts whose HTML/JS we need for listing + catalog scrape. */
const ALLOWED_HOST_SUFFIXES = [
  "bizbuysell.com",
  "businessbroker.net",
  "dealstream.com",
  "loopnet.com",
  "businessesforsale.com",
  /**
   * DataDome challenge (DealStream and similar).
   * Subdomains: geo.captcha-delivery.com, ct.captcha-delivery.com, …
   */
  "captcha-delivery.com",
  /** Akamai asset host occasionally used on BBS pages (small traffic). */
  "akamaihd.net",
  "akamaized.net",
];

const BLOCKED_HOST_SUFFIXES = [
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googletagmanager.com",
  "googletagservices.com",
  "google-analytics.com",
  "googleadservices.com",
  "googlesyndication.com",
  "doubleclick.net",
  "youtube.com",
  "ytimg.com",
  "facebook.com",
  "fbcdn.net",
  "bing.com",
  "linkedin.com",
  "optimizely.com",
  "demandbase.com",
  "company-target.com",
  "rubiconproject.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "pubmatic.com",
  "adsrvr.org",
  "yahoo.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
];

export function browserResourceBlockingEnabled(): boolean {
  return process.env.CLEARBOLT_BROWSER_BLOCK_THIRD_PARTY?.trim() !== "0";
}

export function browserImageBlockingEnabled(): boolean {
  if (process.env.CLEARBOLT_BROWSER_BLOCK_IMAGES?.trim() === "0") {
    return false;
  }
  return (
    process.env.CLEARBOLT_BROWSER_BLOCK_IMAGES?.trim() === "1" ||
    browserResourceBlockingEnabled()
  );
}

/** Prefer Playwright's Chromium over system Chrome when proxied (extensions → gstatic/GTM). */
export function preferBundledChromiumForProxy(): boolean {
  if (process.env.CLEARBOLT_BROWSER_USE_SYSTEM_CHROME?.trim() === "1") {
    return false;
  }
  if (process.env.CLEARBOLT_BROWSER_USE_SYSTEM_CHROME?.trim() === "0") {
    return true;
  }
  return residentialProxyConfigured();
}

export function isCaptchaDeliveryHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "captcha-delivery.com" || h.endsWith(".captcha-delivery.com");
}

function hostnameAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

function hostnameBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return BLOCKED_HOST_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

/**
 * Playwright request filter: drop ads/analytics/fonts/images; keep BBS HTML/JS.
 * HTTP ingest never runs this — only the browser fallback lane.
 */
export function shouldBlockBrowserRequest(
  url: string,
  resourceType: string,
): boolean {
  if (!browserResourceBlockingEnabled()) return false;

  const rt = resourceType.toLowerCase();
  if (rt === "document" || rt === "main_frame") return false;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return true;
  }

  if (hostnameBlocked(host)) return true;

  if (hostnameAllowed(host)) {
    /** DataDome interstitial needs CSS/fonts/images from geo/ct.captcha-delivery.com. */
    if (isCaptchaDeliveryHost(host)) return false;
    if (browserImageBlockingEnabled()) {
      if (
        rt === "image" ||
        rt === "media" ||
        rt === "font" ||
        rt === "stylesheet"
      ) {
        return true;
      }
    }
    return false;
  }

  return true;
}

export async function installBrowserResourceBlocking(context: {
  route: (
    pattern: string,
    handler: (route: {
      request: () => { url: () => string; resourceType: () => string };
      abort: () => Promise<void>;
      continue: () => Promise<void>;
    }) => void | Promise<void>,
  ) => Promise<unknown>;
}): Promise<void> {
  if (!browserResourceBlockingEnabled()) return;

  await context.route("**/*", async (route) => {
    const req = route.request();
    if (shouldBlockBrowserRequest(req.url(), req.resourceType())) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}
