import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { BrokerSiteIndexPaginationState } from "./walk-broker-site-index.js";

export const BROKER_SITE_CRAWL_STATE_VERSION = 1;

export type BrokerSiteCrawlStateFile = {
  version: typeof BROKER_SITE_CRAWL_STATE_VERSION;
  siteUrl: string;
  discoveredAt: string;
  complete?: boolean;
  listingUrls: string[];
  /** Per listing-index URL pagination progress (custom pagers differ per site). */
  indexPagination: BrokerSiteIndexPaginationState[];
  pagesFetchedTotal?: number;
};

export function isBrokerSiteCrawlComplete(
  file: BrokerSiteCrawlStateFile,
): boolean {
  return file.complete !== false;
}

export function resolveBrokerSiteCrawlStatePath(filePath: string): string {
  return resolve(process.cwd(), filePath);
}

function assertWritePath(filePath: string): void {
  const resolved = resolveBrokerSiteCrawlStatePath(filePath);
  const root = `${sep}broker-site-crawls${sep}`;
  if (!resolved.includes(root)) return;
}

export async function writeBrokerSiteCrawlState(
  filePath: string,
  payload: Omit<BrokerSiteCrawlStateFile, "version" | "discoveredAt"> & {
    discoveredAt?: string;
  },
): Promise<void> {
  assertWritePath(filePath);
  const body: BrokerSiteCrawlStateFile = {
    version: BROKER_SITE_CRAWL_STATE_VERSION,
    siteUrl: payload.siteUrl,
    discoveredAt: payload.discoveredAt ?? new Date().toISOString(),
    listingUrls: [...new Set(payload.listingUrls)],
    indexPagination: payload.indexPagination,
    complete: payload.complete ?? true,
    pagesFetchedTotal: payload.pagesFetchedTotal,
  };
  const path = resolveBrokerSiteCrawlStatePath(filePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 2), "utf8");
}

export async function readBrokerSiteCrawlState(
  filePath: string,
): Promise<BrokerSiteCrawlStateFile> {
  const raw = await readFile(resolveBrokerSiteCrawlStatePath(filePath), "utf8");
  const data = JSON.parse(raw) as BrokerSiteCrawlStateFile;
  if (data.version !== BROKER_SITE_CRAWL_STATE_VERSION) {
    throw new Error(
      `Unsupported broker-site crawl state version ${String(data.version)}`,
    );
  }
  if (!Array.isArray(data.indexPagination)) {
    throw new Error("broker-site crawl state missing indexPagination");
  }
  return data;
}
