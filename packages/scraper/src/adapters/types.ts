import type { ListingRef } from "@clearbolt/core";
import type { PaginationStrategy } from "../discovery/pagination/index.js";

/** Catalog / geo index pages: paginated listing discovery. */
export type CatalogAdapter = {
  id: string;
  isCatalogUrl(url: string): boolean;
  discoverListingRefsFromPage(
    html: string,
    pageUrl: string,
  ): Promise<ListingRef[]>;
  paginationStrategies: readonly PaginationStrategy[];
  discoverNextPage(html: string, currentUrl: string): string | null;
  /** Optional host rewrite for fetch (e.g. mobile proxy lane). */
  rewriteCatalogFetchUrl?(url: string): string;
  rewriteNextPageUrl?(nextUrl: string): string;
};
