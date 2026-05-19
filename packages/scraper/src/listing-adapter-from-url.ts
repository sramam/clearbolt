import { listingRefFromBizBuySellUrl } from "./bizbuysell-listing-url.js";
import { listingRefFromBizQuestUrl } from "./bizquest-listing-url.js";
import { listingRefFromBusinessBrokerUrl } from "./businessbroker-listing-url.js";
import { listingRefFromDealStreamUrl } from "./dealstream-listing-url.js";
import { listingRefFromLoopNetUrl } from "./loopnet-listing-url.js";

/** Marketplace adapter id for a listing URL, or null if unsupported. */
export function listingAdapterFromUrl(url: string): string | null {
  if (listingRefFromBizBuySellUrl(url)) return "bizbuysell";
  if (listingRefFromBizQuestUrl(url)) return "bizquest";
  if (listingRefFromBusinessBrokerUrl(url)) return "businessbroker";
  if (listingRefFromLoopNetUrl(url)) return "loopnet";
  if (listingRefFromDealStreamUrl(url)) return "dealstream";
  return null;
}
