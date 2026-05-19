/** Hosts we treat as marketplaces — never crawl or follow for broker-site ingestion. */
const MARKETPLACE_HOST_SUFFIXES = [
  "bizbuysell.com",
  "bizquest.com",
  "loopnet.com",
  "businessbroker.net",
  "businessesforsale.com",
  "dealstream.com",
  "axial.net",
  "axial.com",
  "bizben.com",
  "acquire.com",
  "empireflippers.com",
  "quietlight.com",
  "feinternational.com",
  "batonmarket.com",
  "searchfunder.com",
] as const;

export function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function isMarketplaceHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  return MARKETPLACE_HOST_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

export function isMarketplaceUrl(url: string): boolean {
  try {
    return isMarketplaceHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function registrableDomain(hostname: string): string {
  const h = normalizeHost(hostname);
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}
