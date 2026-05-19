import { normalizeHost, registrableDomain } from "./marketplace-hosts.js";

export function brokerSiteAllowlistFromEnv(): Set<string> | null {
  const raw = process.env.CLEARBOLT_BROKER_SITE_ALLOWLIST?.trim();
  if (!raw) return null;
  const domains = raw
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return new Set(domains);
}

export function isBrokerSiteCrawlAllowed(
  siteUrl: string,
  allowlist: Set<string> | null,
): boolean {
  if (!allowlist) return true;
  try {
    const host = normalizeHost(new URL(siteUrl).hostname);
    const reg = registrableDomain(host);
    return allowlist.has(host) || allowlist.has(reg);
  } catch {
    return false;
  }
}
