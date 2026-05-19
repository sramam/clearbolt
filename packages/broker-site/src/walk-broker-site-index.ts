import type { BrokerSiteListingLink } from "./discover-listing-links.js";
import { isMarketplaceUrl } from "./marketplace-hosts.js";
import {
  discoverNextBrokerSiteIndexPageUrl,
  type BrokerSitePaginationResult,
} from "./broker-site-pagination.js";

export type BrokerSiteIndexPaginationState = {
  indexUrl: string;
  pagesFetched: number;
  lastPageUrl: string;
  nextPageUrl: string | null;
  complete: boolean;
  /** Strategy that last advanced pagination (`rel-next`, `query-page`, …). */
  lastPaginationStrategy?: string | null;
};

export type WalkBrokerSiteIndexOptions = {
  indexUrl: string;
  maxPages: number;
  fetchPage: (url: string, ctx: { pageIndex: number }) => Promise<{
    body: string;
    finalUrl: string;
  }>;
  discoverLinks: (html: string, pageUrl: string) => BrokerSiteListingLink[];
  initialPagination?: BrokerSiteIndexPaginationState;
  onProgress?: (msg: string) => void;
  onPageComplete?: (state: BrokerSiteIndexPaginationState) => void | Promise<void>;
};

export type WalkBrokerSiteIndexResult = {
  links: BrokerSiteListingLink[];
  pagination: BrokerSiteIndexPaginationState;
};

function mergeLinks(
  merged: Map<string, BrokerSiteListingLink>,
  pageLinks: BrokerSiteListingLink[],
): void {
  for (const link of pageLinks) {
    if (isMarketplaceUrl(link.url)) continue;
    merged.set(link.url, link);
  }
}

export async function walkBrokerSiteIndexPages(
  options: WalkBrokerSiteIndexOptions,
): Promise<WalkBrokerSiteIndexResult> {
  const merged = new Map<string, BrokerSiteListingLink>();
  const resume = options.initialPagination;
  let url: string | null = resume?.nextPageUrl ?? options.indexUrl;
  let pagesFetched = resume?.pagesFetched ?? 0;
  let lastPageUrl = resume?.lastPageUrl ?? options.indexUrl;
  let lastStrategy: string | null = resume?.lastPaginationStrategy ?? null;

  if (resume?.complete) {
    return {
      links: [],
      pagination: resume,
    };
  }

  while (url) {
    if (options.maxPages > 0 && pagesFetched >= options.maxPages) break;

    const pageNum = pagesFetched + 1;
    options.onProgress?.(`Index page ${pageNum}: ${url}`);

    const { body, finalUrl } = await options.fetchPage(url, {
      pageIndex: pagesFetched,
    });
    pagesFetched++;
    lastPageUrl = finalUrl;

    const pageLinks = options.discoverLinks(body, finalUrl);
    mergeLinks(merged, pageLinks);

    const pagination: BrokerSitePaginationResult =
      discoverNextBrokerSiteIndexPageUrl(body, finalUrl);
    const nextUrl = pagination.nextUrl;
    lastStrategy = pagination.strategyId;

    const state: BrokerSiteIndexPaginationState = {
      indexUrl: options.indexUrl,
      pagesFetched,
      lastPageUrl,
      nextPageUrl: nextUrl,
      complete: nextUrl === null || nextUrl === finalUrl,
      lastPaginationStrategy: lastStrategy,
    };
    await options.onPageComplete?.(state);

    if (state.complete) break;
    if (options.maxPages > 0 && pagesFetched >= options.maxPages) break;
    url = nextUrl;
  }

  return {
    links: [...merged.values()],
    pagination: {
      indexUrl: options.indexUrl,
      pagesFetched,
      lastPageUrl,
      nextPageUrl: null,
      complete: true,
      lastPaginationStrategy: lastStrategy,
    },
  };
}
