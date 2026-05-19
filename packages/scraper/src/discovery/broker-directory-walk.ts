import type { BrokerDirectoryRef } from "../broker-directory-ref.js";
import { mergeBrokerDirectoryRef } from "../broker-directory-ref.js";
import {
  CatalogPageBlockedError,
  detectCatalogPageBlock,
} from "../catalog-page-block.js";
import { formatCatalogPageDuration } from "./catalog-walk.js";

export interface BrokerDirectoryWalkProgress {
  phase: "discovery";
  message: string;
  current?: number;
  total?: number;
}

export interface WalkBrokerDirectoryPagesOptions {
  startUrl: string;
  directoryBaseUrl?: string;
  maxPages: number;
  maxBrokers: number;
  fetchPage: (
    url: string,
    ctx: { pageIndex: number },
  ) => Promise<{ body: string; finalUrl: string; status?: number }>;
  discoverRefs: (html: string, pageUrl: string) => BrokerDirectoryRef[];
  discoverNext: (
    html: string,
    pageUrl: string,
    pageNumber: number,
  ) => string | null;
  isDirectoryUrl: (url: string) => boolean;
  recoverDirectoryPageUrl: (baseUrl: string, pageNumber: number) => string;
  initialRefs?: BrokerDirectoryRef[];
  resumeFromUrl?: string;
  initialPagesFetched?: number;
  onProgress?: (progress: BrokerDirectoryWalkProgress) => void;
  onPageComplete?: (detail: {
    refs: BrokerDirectoryRef[];
    pagesFetched: number;
    lastPageUrl: string;
    nextPageUrl: string | null;
  }) => void | Promise<void>;
}

export interface BrokerDirectoryWalkResult {
  refs: BrokerDirectoryRef[];
  pagesFetched: number;
  lastPageUrl: string;
  lastHtml: string;
}

export async function walkBrokerDirectoryPages(
  options: WalkBrokerDirectoryPagesOptions,
): Promise<BrokerDirectoryWalkResult> {
  const merged = new Map<string, BrokerDirectoryRef>();
  if (options.initialRefs?.length) {
    for (const ref of options.initialRefs) {
      mergeBrokerDirectoryRef(merged, ref);
    }
  }

  let url: string | null = options.resumeFromUrl ?? options.startUrl;
  let pagesFetched = options.initialPagesFetched ?? 0;
  let lastPageUrl = options.startUrl;
  let lastHtml = "";

  while (url) {
    if (options.maxPages > 0 && pagesFetched >= options.maxPages) break;

    const pageNum = pagesFetched + 1;
    options.onProgress?.({
      phase: "discovery",
      message: `Loading broker directory page ${pageNum}…`,
      current: pageNum,
      total: options.maxPages > 0 ? options.maxPages : undefined,
    });

    const pageStarted = performance.now();
    const {
      body,
      finalUrl,
      status: pageStatus,
    } = await options.fetchPage(url, {
      pageIndex: pagesFetched,
    });
    pagesFetched++;

    const pageUrlForPagination =
      options.directoryBaseUrl && !options.isDirectoryUrl(finalUrl)
        ? options.recoverDirectoryPageUrl(
            options.directoryBaseUrl,
            pagesFetched,
          )
        : finalUrl;
    lastPageUrl = pageUrlForPagination;
    lastHtml = body;

    const pageRefs = options.discoverRefs(body, lastPageUrl);
    const before = merged.size;
    for (const ref of pageRefs) {
      mergeBrokerDirectoryRef(merged, ref);
      if (options.maxBrokers > 0 && merged.size >= options.maxBrokers) break;
    }
    const added = merged.size - before;

    const samples = pageRefs
      .slice(0, 2)
      .map((r) => r.profileUrl)
      .join(" | ");
    const sampleSuffix = samples ? ` — e.g. ${samples}` : "";
    const pageMs = performance.now() - pageStarted;
    options.onProgress?.({
      phase: "discovery",
      message:
        `Page ${pagesFetched}: ${pageRefs.length} broker link(s) (${merged.size} unique, ${added} new) ` +
        `in ${formatCatalogPageDuration(pageMs)}${sampleSuffix}`,
      current: pagesFetched,
    });

    if (options.maxBrokers > 0 && merged.size >= options.maxBrokers) break;

    if (pageRefs.length === 0 && (pageStatus ?? 200) !== 0) {
      const block = detectCatalogPageBlock(pageStatus ?? 200, body);
      if (block) {
        throw new CatalogPageBlockedError(
          `${block.message} (${lastPageUrl})`,
          block,
          lastPageUrl,
          pageStatus ?? 200,
        );
      }
    }

    const nextUrl = options.discoverNext(body, lastPageUrl, pagesFetched);
    await options.onPageComplete?.({
      refs: [...merged.values()],
      pagesFetched,
      lastPageUrl,
      nextPageUrl: nextUrl,
    });

    if (!nextUrl || nextUrl === url) break;
    url = nextUrl;
  }

  return {
    refs: [...merged.values()],
    pagesFetched,
    lastPageUrl,
    lastHtml,
  };
}
