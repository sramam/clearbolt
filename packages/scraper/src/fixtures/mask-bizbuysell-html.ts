import * as cheerio from "cheerio";

/**
 * Strip volatile markup that churns between captures (ads, trackers, inline
 * styles/scripts). Extend this list as diffs show noisy nodes — treat it as a
 * living allowlist/denylist, not a security sanitizer.
 */
export function maskBizBuySellHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  $(
    "link[rel='preload'], link[rel='prefetch'], link[rel='modulepreload']",
  ).remove();
  $("[id^='google_ads'], [class*='google-ad'], [data-ad]").remove();
  return ($.root().html() ?? "").replace(/\s+/g, " ").trim();
}
