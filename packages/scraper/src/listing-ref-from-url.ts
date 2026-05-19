import type { ListingRef } from "@clearbolt/core";
import { listingRefFromBizBuySellUrl } from "./bizbuysell-listing-url.js";
import { listingRefFromBizQuestUrl } from "./bizquest-listing-url.js";
import { listingRefFromBusinessBrokerUrl } from "./businessbroker-listing-url.js";
import { listingRefFromDealStreamUrl } from "./dealstream-listing-url.js";
import { listingRefFromLoopNetUrl } from "./loopnet-listing-url.js";

/** Normalize a listing URL from any supported marketplace host. */
export function listingRefFromKnownSourceUrl(url: string): ListingRef | null {
  return (
    listingRefFromBizBuySellUrl(url) ??
    listingRefFromBizQuestUrl(url) ??
    listingRefFromBusinessBrokerUrl(url) ??
    listingRefFromLoopNetUrl(url) ??
    listingRefFromDealStreamUrl(url)
  );
}
