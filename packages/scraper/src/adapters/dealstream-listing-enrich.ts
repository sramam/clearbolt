import type { FetchHtmlWithHttpWafPolicyOptions } from "../fetch-with-waf-policy.js";
import { fetchHtmlWithHttpWafPolicy } from "../fetch-with-waf-policy.js";
import type { Fetcher } from "../fetcher.js";
import {
  isListingOnBrokerProfile,
  parseDealStreamBrokerProfilePage,
} from "./dealstream-broker-parse.js";
import type { DealStreamListingExtract } from "./dealstream-listing-parse.js";

export function brokerProfileEnrichEnabled(): boolean {
  return process.env.CLEARBOLT_DEALSTREAM_BROKER_ENRICH?.trim() === "1";
}

/** Optional: fetch broker profile to fill contact fields when the listing page omits them. */
export async function enrichListingFromBrokerProfile(
  extract: DealStreamListingExtract,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
): Promise<void> {
  if (!brokerProfileEnrichEnabled()) return;
  const profileUrl = extract.brokerProfileUrl;
  const listingId = extract.externalId ?? extract.listingId;
  if (!profileUrl || !listingId) return;

  const { body } = await fetchHtmlWithHttpWafPolicy(
    fetcher,
    profileUrl,
    wafPolicy,
  );
  const profile = parseDealStreamBrokerProfilePage(body, profileUrl);

  if (!extract.brokerName && profile.name) {
    extract.brokerName = profile.name;
  }
  if (!extract.brokerName && profile.firm) {
    extract.brokerName = profile.firm;
  }
  if (profile.email && !extract.brokerName) {
    extract.brokerName = profile.email;
  }

  void isListingOnBrokerProfile(profile, listingId);
}

export async function enrichListingExtract(
  extract: DealStreamListingExtract,
  _html: string,
  ctx: {
    fetcher: Fetcher;
    wafPolicy: FetchHtmlWithHttpWafPolicyOptions;
  },
): Promise<void> {
  await enrichListingFromBrokerProfile(extract, ctx.fetcher, ctx.wafPolicy);
}
