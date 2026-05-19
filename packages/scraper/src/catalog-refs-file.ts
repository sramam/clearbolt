import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ListingRef } from "@clearbolt/core";
import { normalizeAdapterId } from "./adapter-scoped-paths.js";
import { catalogAdapterFromUrl } from "./catalog-adapter-from-url.js";
import { listingAdapterFromUrl } from "./listing-adapter-from-url.js";
import { listingRefFromKnownSourceUrl } from "./listing-ref-from-url.js";

export class CatalogRefsAdapterMismatchError extends Error {
  readonly name = "CatalogRefsAdapterMismatchError";
  constructor(
    message: string,
    readonly expectedAdapter: string,
    readonly fileAdapter: string,
  ) {
    super(message);
  }
}

export const CATALOG_REFS_FILE_VERSION = 1;

export type CatalogRefsFile = {
  version: typeof CATALOG_REFS_FILE_VERSION;
  /** Marketplace adapter (`bizbuysell`, `loopnet`, …). */
  adapter: string;
  catalogUrl: string;
  discoveredAt: string;
  refs: ListingRef[];
  /** False while pagination is in progress; omitted on older files (= complete). */
  complete?: boolean;
  pagesFetched?: number;
  lastPageUrl?: string;
  /** Next catalog page to fetch when `complete` is false. */
  nextPageUrl?: string;
};

/** True when discovery finished (or file predates checkpoint fields). */
export function isCatalogDiscoveryComplete(file: CatalogRefsFile): boolean {
  return file.complete !== false;
}

export type WriteCatalogRefsPayload = Omit<
  CatalogRefsFile,
  "version" | "discoveredAt" | "refs" | "adapter"
> & {
  adapter?: string;
  discoveredAt?: string;
  refs: ListingRef[];
  complete?: boolean;
};

export function resolveCatalogRefsPath(filePath: string): string {
  return resolve(process.cwd(), filePath);
}

/** Ensure cached discovery belongs to the adapter running ingest. */
export function assertCatalogRefsAdapter(
  file: CatalogRefsFile,
  expectedAdapter: string,
): void {
  if (file.adapter !== expectedAdapter) {
    throw new CatalogRefsAdapterMismatchError(
      `Catalog refs adapter mismatch: file is ${file.adapter}, run expects ${expectedAdapter} (${file.catalogUrl})`,
      expectedAdapter,
      file.adapter,
    );
  }
}

/** Normalize refs (www URL + externalId from path when missing). */
export function normalizeCatalogRefs(
  refs: ListingRef[],
  adapter?: string,
): ListingRef[] {
  const out: ListingRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const parsed = listingRefFromKnownSourceUrl(ref.url);
    if (adapter) {
      const refAdapter = listingAdapterFromUrl(ref.url);
      if (refAdapter && refAdapter !== adapter) continue;
    }
    const externalId = ref.externalId ?? parsed?.externalId;
    const url = parsed?.url ?? ref.url;
    const key = externalId ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, externalId });
  }
  return out;
}

function assertCatalogRefsWritePath(filePath: string, adapter: string): void {
  const resolved = resolveCatalogRefsPath(filePath);
  const catalogRefsRoot = `${sep}catalog-refs${sep}`;
  if (!resolved.includes(catalogRefsRoot)) return;
  const scoped = `${catalogRefsRoot}${normalizeAdapterId(adapter)}${sep}`;
  if (!resolved.includes(scoped)) {
    throw new Error(
      `Catalog refs must be written under catalog-refs/${normalizeAdapterId(adapter)}/ (got ${filePath})`,
    );
  }
}

export async function writeCatalogRefsFile(
  filePath: string,
  payload: WriteCatalogRefsPayload,
): Promise<void> {
  const complete = payload.complete ?? true;
  const adapter = payload.adapter ?? catalogAdapterFromUrl(payload.catalogUrl);
  assertCatalogRefsWritePath(filePath, adapter);
  const body: CatalogRefsFile = {
    version: CATALOG_REFS_FILE_VERSION,
    adapter,
    catalogUrl: payload.catalogUrl,
    discoveredAt: payload.discoveredAt ?? new Date().toISOString(),
    refs: normalizeCatalogRefs(payload.refs, adapter),
    complete,
    ...(payload.pagesFetched !== undefined
      ? { pagesFetched: payload.pagesFetched }
      : {}),
    ...(payload.lastPageUrl ? { lastPageUrl: payload.lastPageUrl } : {}),
    ...(payload.nextPageUrl && !complete
      ? { nextPageUrl: payload.nextPageUrl }
      : {}),
  };
  const path = resolveCatalogRefsPath(filePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 2), "utf8");
}

export type ReadCatalogRefsFileOptions = {
  /** When set, reject files for another marketplace (legacy paths may collide on slug). */
  expectedAdapter?: string;
};

export async function readCatalogRefsFile(
  filePath: string,
  options?: ReadCatalogRefsFileOptions,
): Promise<CatalogRefsFile> {
  const raw = await readFile(resolveCatalogRefsPath(filePath), "utf8");
  const data = JSON.parse(raw) as CatalogRefsFile;
  if (data.version !== CATALOG_REFS_FILE_VERSION) {
    throw new Error(
      `Unsupported catalog refs file version ${String(data.version)} (expected ${CATALOG_REFS_FILE_VERSION})`,
    );
  }
  if (!data.catalogUrl?.trim()) {
    throw new Error("Catalog refs file missing catalogUrl");
  }
  if (!Array.isArray(data.refs)) {
    throw new Error("Catalog refs file missing refs array");
  }
  const adapter =
    data.adapter?.trim() || catalogAdapterFromUrl(data.catalogUrl);
  if (data.adapter?.trim() && data.adapter !== adapter) {
    throw new Error(
      `Catalog refs adapter mismatch: file has ${data.adapter}, URL implies ${adapter}`,
    );
  }
  const file: CatalogRefsFile = {
    ...data,
    adapter,
    refs: normalizeCatalogRefs(data.refs, adapter),
  };
  if (options?.expectedAdapter) {
    assertCatalogRefsAdapter(file, options.expectedAdapter);
    const urlAdapter = catalogAdapterFromUrl(file.catalogUrl);
    if (urlAdapter !== options.expectedAdapter) {
      throw new CatalogRefsAdapterMismatchError(
        `Catalog URL is for adapter ${urlAdapter}, run expects ${options.expectedAdapter} (${file.catalogUrl})`,
        options.expectedAdapter,
        urlAdapter,
      );
    }
  }
  return file;
}
