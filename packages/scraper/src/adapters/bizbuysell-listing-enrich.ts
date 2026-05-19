import type { FetchHtmlWithHttpWafPolicyOptions } from "../fetch-with-waf-policy.js";
import { fetchHtmlWithHttpWafPolicy } from "../fetch-with-waf-policy.js";
import type { Fetcher } from "../fetcher.js";
import {
  isListingSoldOnBrokerProfile,
  parseBizBuySellBrokerProfilePage,
} from "./bizbuysell-broker-parse.js";
import { enrichListingWithLlm } from "./bizbuysell-listing-llm-enrich.js";
import type { BizBuySellListingExtract } from "./bizbuysell-listing-parse.js";
import { bizBuySellListingFetchUrl } from "./bizbuysell.js";

export function brokerProfileEnrichEnabled(): boolean {
  return process.env.CLEARBOLT_BIZBUYSELL_BROKER_ENRICH?.trim() === "1";
}

/**
 * When enabled, fetches the broker profile page and marks the listing Sold if it
 * appears on the broker's sold tab (even when the listing page omits status).
 */
export async function enrichListingFromBrokerProfile(
  extract: BizBuySellListingExtract,
  fetcher: Fetcher,
  wafPolicy: FetchHtmlWithHttpWafPolicyOptions,
): Promise<void> {
  if (!brokerProfileEnrichEnabled()) return;
  if (extract.status === "Sold") return;
  const profileUrl = extract.brokerProfileUrl;
  const listingId = extract.externalId ?? extract.listingId;
  if (!profileUrl || !listingId) return;

  const fetchUrl = bizBuySellListingFetchUrl(profileUrl);
  const { body } = await fetchHtmlWithHttpWafPolicy(
    fetcher,
    fetchUrl,
    wafPolicy,
  );
  const profile = parseBizBuySellBrokerProfilePage(body, profileUrl);

  if (isListingSoldOnBrokerProfile(profile, listingId)) {
    extract.status = "Sold";
    extract.soldSource = "broker-profile";
  }

  if (!extract.intermediaryEmail && profile.email) {
    extract.intermediaryEmail = profile.email;
  }
  if (!extract.intermediaryPhone && profile.phone) {
    extract.intermediaryPhone = profile.phone;
  }
  if (!extract.intermediaryFirm && profile.firm) {
    extract.intermediaryFirm = profile.firm;
  }
  if (!extract.brokerageNote && profile.about) {
    extract.brokerageNote = profile.about.slice(0, 8000);
  }
  extract.enrichSources = [...(extract.enrichSources ?? []), "broker-profile"];
}

/**
 * Post-ingest enrich: broker profile (optional) then LLM gap-fill (optional).
 * Discover → ingest (deterministic parse) → enrich.
 */
export async function enrichListingExtract(
  extract: BizBuySellListingExtract,
  html: string,
  ctx: {
    fetcher: Fetcher;
    wafPolicy: FetchHtmlWithHttpWafPolicyOptions;
  },
): Promise<void> {
  await enrichListingFromBrokerProfile(extract, ctx.fetcher, ctx.wafPolicy);
  await enrichListingWithLlm(extract, html);
}
