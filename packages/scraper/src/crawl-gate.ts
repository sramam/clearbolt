import {
  crawlDelayMsFromRobots,
  isUrlAllowedByRobots,
  loadRobotsForOrigin,
  scraperUserAgent,
} from "./robots-policy.js";
import { throttleHost } from "./throttle.js";

export class RobotsDisallowedError extends Error {
  readonly url: string;
  readonly host: string;

  constructor(url: string, host: string) {
    super(`robots.txt disallows fetch: ${url}`);
    this.name = "RobotsDisallowedError";
    this.url = url;
    this.host = host;
  }
}

export type CrawlGateOptions = {
  /** Skip robots.txt checks (tests, explicit override). */
  skipRobots?: boolean;
  /** Minimum ms between requests to the same host (floor). */
  minGapMs?: number;
  userAgent?: string;
  fetchRobots?: (url: string) => Promise<string | null>;
};

function robotsEnabled(): boolean {
  return process.env.CLEARBOLT_SCRAPER_ROBOTS !== "0";
}

export function defaultMinGapMs(): number {
  const raw = process.env.CLEARBOLT_SCRAPER_MIN_GAP_MS;
  if (raw != null && raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 1000;
}

async function defaultFetchRobots(url: string): Promise<string | null> {
  const res = await fetch(url, {
    method: "GET",
    headers: { "user-agent": scraperUserAgent() },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.text();
}

/**
 * Enforce robots.txt (when enabled) and per-host minimum spacing before a fetch.
 * Call once per HTTP/browser request to a host.
 */
export async function beforeCrawlFetch(
  url: string,
  options: CrawlGateOptions = {},
): Promise<void> {
  const u = new URL(url);
  const host = u.hostname;
  const pathname = u.pathname || "/";

  const minGap = options.minGapMs ?? defaultMinGapMs();
  let delayMs = minGap;

  const checkRobots = !options.skipRobots && robotsEnabled();
  if (checkRobots && pathname !== "/robots.txt") {
    const origin = u.origin;
    const fetchRobots = options.fetchRobots ?? defaultFetchRobots;
    const parsed = await loadRobotsForOrigin(origin, fetchRobots);
    const ua = options.userAgent ?? scraperUserAgent();
    if (!isUrlAllowedByRobots(url, parsed, ua)) {
      throw new RobotsDisallowedError(url, host);
    }
    const robotsDelay = parsed ? crawlDelayMsFromRobots(parsed, ua) : undefined;
    if (robotsDelay != null) delayMs = Math.max(delayMs, robotsDelay);
  }

  await throttleHost(host, delayMs);
}
