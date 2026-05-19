/** Rewrite www BizBuySell URLs to the mobile host (Apify crawlerbros pattern). */
export function rewriteBizBuySellToMobileUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === "www.bizbuysell.com") {
    u.hostname = "m.bizbuysell.com";
  } else if (u.hostname === "bizbuysell.com") {
    u.hostname = "m.bizbuysell.com";
  }
  return u.toString();
}

/** Normalize listing/catalog URLs back to www for stored canonical URLs. */
export function rewriteBizBuySellToDesktopUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === "m.bizbuysell.com") {
    u.hostname = "www.bizbuysell.com";
  }
  return u.toString();
}
