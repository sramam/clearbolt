import { isBizBuySellCatalogUrl } from "./adapters/bizbuysell-catalog.js";
import { isBusinessBrokerCatalogUrl } from "./adapters/businessbroker/catalog.js";
import { isBusinessesForSaleCatalogUrl } from "./adapters/businessesforsale/catalog.js";
import { isDealStreamCatalogUrl } from "./adapters/dealstream/catalog.js";
import { isLoopNetCatalogUrl } from "./adapters/loopnet/catalog.js";
import { isBizQuestSearchUrl } from "./bizquest-search-url.js";

/** Adapter id for a catalog / search index URL (`bizbuysell`, `dealstream`, …). */
export function catalogAdapterFromUrl(catalogUrl: string): string {
  if (isLoopNetCatalogUrl(catalogUrl)) return "loopnet";
  if (isDealStreamCatalogUrl(catalogUrl)) return "dealstream";
  if (isBusinessBrokerCatalogUrl(catalogUrl)) return "businessbroker";
  if (isBusinessesForSaleCatalogUrl(catalogUrl)) return "businessesforsale";
  if (isBizBuySellCatalogUrl(catalogUrl)) return "bizbuysell";
  if (isBizQuestSearchUrl(catalogUrl)) return "bizquest";
  try {
    return new URL(catalogUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "unknown";
  }
}
