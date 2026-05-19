import type { ParsedListingFields } from "@clearbolt/core";
import {
  parseBusinessBrokerListingPage,
  toParsedListingFields,
} from "./businessbroker-listing-parse.js";

export function parseListingPage(
  html: string,
  url: string,
): ParsedListingFields & { externalId?: string } {
  return toParsedListingFields(parseBusinessBrokerListingPage(html, url));
}
