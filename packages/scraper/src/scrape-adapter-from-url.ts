import { isBizBuySellCatalogUrl } from "./adapters/bizbuysell-catalog.js";
import { isBusinessBrokerCatalogUrl } from "./adapters/businessbroker/catalog.js";
import { isDealStreamCatalogUrl } from "./adapters/dealstream/catalog.js";
import { isLoopNetCatalogUrl } from "./adapters/loopnet/catalog.js";
import { catalogAdapterFromUrl } from "./catalog-adapter-from-url.js";
import { isBizQuestListingUrl } from "./bizquest-listing-url.js";
import { isBizQuestSearchUrl } from "./bizquest-search-url.js";
import { isBizBuySellListingUrl } from "./bizbuysell-listing-url.js";

/** Adapter id for a search URL, listing URL, or catalog index URL. */
export function scrapeAdapterFromUrl(url: string): string {
  if (isBizQuestSearchUrl(url) || isBizQuestListingUrl(url)) {
    return "bizquest";
  }
  if (isBizBuySellListingUrl(url) || isBizBuySellCatalogUrl(url)) {
    return "bizbuysell";
  }
  if (isLoopNetCatalogUrl(url)) return "loopnet";
  if (isDealStreamCatalogUrl(url)) return "dealstream";
  if (isBusinessBrokerCatalogUrl(url)) return "businessbroker";
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("bizquest.com")) return "bizquest";
    if (host.includes("bizbuysell.com")) return "bizbuysell";
    if (host.includes("businessbroker.net")) return "businessbroker";
    if (host.includes("dealstream.com")) return "dealstream";
    if (host.includes("loopnet.com")) return "loopnet";
  } catch {
    /* fall through */
  }
  return catalogAdapterFromUrl(url);
}
