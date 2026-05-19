import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceRef, ListingRef } from "@clearbolt/core";
import { normalizeAdapterId } from "./adapter-scoped-paths.js";
import { listingRefDedupeKey } from "./discovery/listing-ref-merge.js";
import { listingRefFromKnownSourceUrl } from "./listing-ref-from-url.js";

export const LISTING_INGEST_STATE_VERSION = 1;

export type ListingIngestStatus =
  | "ingested"
  | "failed"
  | "skipped_known"
  | "skipped_fresh";

/** Listing already satisfied — no fetch needed on resume (includes legacy `skipped_known` rows). */
export function isSatisfiedListingStatus(
  status: ListingIngestStatus | undefined,
): boolean {
  return (
    status === "ingested" ||
    status === "skipped_known" ||
    status === "skipped_fresh"
  );
}

export type ListingIngestFailureTrace = {
  message: string;
  at: string;
  name?: string;
  stack?: string;
};

export type ListingIngestState = {
  version: typeof LISTING_INGEST_STATE_VERSION;
  adapter: string;
  externalId: string;
  url: string;
  status: ListingIngestStatus;
  at: string;
  sourceRecordId?: string;
  canonicalId?: string;
  evidenceRef?: EvidenceRef;
  processedArtifactKeys?: string[];
  failure?: ListingIngestFailureTrace;
};

export interface ListingIngestStateStore {
  get(adapter: string, externalId: string): Promise<ListingIngestState | null>;
  put(state: ListingIngestState): Promise<void>;
  /** Dedupe keys (`id:…`) for listings already satisfied (ingested / skip markers). */
  listIngestedDedupeKeys(adapter: string): Promise<Set<string>>;
}

export interface ListingIngestStateJsonBackend {
  getJson(adapter: string, externalId: string): Promise<string | null>;
  putJson(adapter: string, externalId: string, body: string): Promise<void>;
}

function listingIngestStateKey(externalId: string): string {
  return `id:${externalId}`;
}

export function externalIdFromListingRef(ref: ListingRef): string | null {
  if (ref.externalId) return ref.externalId;
  return listingRefFromKnownSourceUrl(ref.url)?.externalId ?? null;
}

export function catalogStalePagesToStop(): number {
  const raw = process.env.CLEARBOLT_CATALOG_STALE_PAGES_STOP?.trim();
  if (raw === "0") return 0;
  if (raw !== undefined && raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 2;
}

function parseState(raw: string): ListingIngestState | null {
  try {
    const data = JSON.parse(raw) as ListingIngestState;
    if (data.version !== LISTING_INGEST_STATE_VERSION) return null;
    if (!data.externalId || !data.adapter) return null;
    return data;
  } catch {
    return null;
  }
}

export function serializeListingIngestState(state: ListingIngestState): string {
  return JSON.stringify(state, null, 2);
}

export class DiskListingIngestStateStore implements ListingIngestStateStore {
  constructor(private readonly rootDir: string) {}

  private filePath(adapter: string, externalId: string): string {
    const safeId = externalId.replace(/[^a-zA-Z0-9._-]+/g, "_");
    return join(
      this.rootDir,
      "listing-ingest-state",
      adapter,
      safeId,
      "state.json",
    );
  }

  async get(adapter: string, externalId: string): Promise<ListingIngestState | null> {
    try {
      const raw = await readFile(this.filePath(adapter, externalId), "utf8");
      const state = parseState(raw);
      if (state && normalizeAdapterId(state.adapter) !== normalizeAdapterId(adapter)) {
        return null;
      }
      return state;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  async put(state: ListingIngestState): Promise<void> {
    const adapter = normalizeAdapterId(state.adapter);
    const path = this.filePath(adapter, state.externalId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serializeListingIngestState({ ...state, adapter }), "utf8");
  }

  async listIngestedDedupeKeys(adapter: string): Promise<Set<string>> {
    const dir = join(this.rootDir, "listing-ingest-state", adapter);
    const keys = new Set<string>();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return keys;
      throw err;
    }
    for (const entry of entries) {
      const statePath = join(dir, entry, "state.json");
      try {
        const raw = await readFile(statePath, "utf8");
        const state = parseState(raw);
        if (
          state &&
          normalizeAdapterId(state.adapter) === normalizeAdapterId(adapter) &&
          isSatisfiedListingStatus(state.status)
        ) {
          keys.add(listingIngestStateKey(state.externalId));
        }
      } catch {
        /* skip corrupt dirs */
      }
    }
    return keys;
  }
}

export class JsonBackendListingIngestStateStore
  implements ListingIngestStateStore
{
  constructor(private readonly backend: ListingIngestStateJsonBackend) {}

  async get(adapter: string, externalId: string): Promise<ListingIngestState | null> {
    const raw = await this.backend.getJson(adapter, externalId);
    if (!raw) return null;
    return parseState(raw);
  }

  async put(state: ListingIngestState): Promise<void> {
    await this.backend.putJson(
      state.adapter,
      state.externalId,
      serializeListingIngestState(state),
    );
  }

  async listIngestedDedupeKeys(_adapter: string): Promise<Set<string>> {
    return new Set();
  }
}

export function compositeListingIngestStateStore(
  ...stores: ListingIngestStateStore[]
): ListingIngestStateStore {
  const active = stores.filter(Boolean);
  return {
    async get(adapter, externalId) {
      for (const store of active) {
        const state = await store.get(adapter, externalId);
        if (state) return state;
      }
      return null;
    },
    async put(state) {
      await Promise.all(active.map((s) => s.put(state)));
    },
    async listIngestedDedupeKeys(adapter) {
      const keys = new Set<string>();
      for (const store of active) {
        for (const k of await store.listIngestedDedupeKeys(adapter)) {
          keys.add(k);
        }
      }
      return keys;
    },
  };
}

export function buildListingIngestState(
  partial: Omit<ListingIngestState, "version" | "at"> & { at?: string },
): ListingIngestState {
  return {
    version: LISTING_INGEST_STATE_VERSION,
    at: partial.at ?? new Date().toISOString(),
    ...partial,
  };
}

export async function persistListingIngestState(
  store: ListingIngestStateStore | undefined,
  partial: Omit<ListingIngestState, "version" | "at"> & { at?: string },
): Promise<void> {
  if (!store) return;
  await store.put(buildListingIngestState(partial));
}

export async function seedKnownKeysForCatalogDiscovery(
  store: ListingIngestStateStore | undefined,
  adapter: string,
): Promise<Set<string>> {
  if (!store) return new Set();
  return store.listIngestedDedupeKeys(adapter);
}

/** How many refs are already satisfied on disk (for resume progress). */
export async function countSatisfiedInRefList(
  store: ListingIngestStateStore | undefined,
  adapter: string,
  refs: readonly ListingRef[],
): Promise<number> {
  if (!store || refs.length === 0) return 0;
  const ingestedKeys = await store.listIngestedDedupeKeys(adapter);
  let count = 0;
  for (const ref of refs) {
    if (ingestedKeys.has(listingRefDedupeKey(ref))) count++;
  }
  return count;
}

/** @deprecated Use `countSatisfiedInRefList` */
export const countIngestedInRefList = countSatisfiedInRefList;

export type ListingIngestStateCounts = {
  ingested: number;
  failed: number;
  skipped_known: number;
  skipped_fresh: number;
  total: number;
};

/** Count per-status rows under `listing-ingest-state/<adapter>/`. */
export async function countListingIngestStatesOnDisk(
  dataRootDir: string,
  adapter: string,
): Promise<ListingIngestStateCounts> {
  const counts: ListingIngestStateCounts = {
    ingested: 0,
    failed: 0,
    skipped_known: 0,
    skipped_fresh: 0,
    total: 0,
  };
  const base = join(
    dataRootDir,
    "listing-ingest-state",
    normalizeAdapterId(adapter),
  );
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return counts;
    throw err;
  }
  for (const entry of entries) {
    const statePath = join(base, entry, "state.json");
    try {
      const raw = await readFile(statePath, "utf8");
      const state = parseState(raw);
      if (!state?.externalId) continue;
      if (normalizeAdapterId(state.adapter) !== normalizeAdapterId(adapter)) {
        continue;
      }
      counts.total++;
      if (state.status === "ingested") counts.ingested++;
      else if (state.status === "failed") counts.failed++;
      else if (state.status === "skipped_known") counts.skipped_known++;
      else if (state.status === "skipped_fresh") counts.skipped_fresh++;
    } catch {
      /* skip */
    }
  }
  return counts;
}

export function dedupeKeyForListingRef(ref: ListingRef): string {
  return listingRefDedupeKey(ref);
}

export function failureTraceFromError(err: unknown): ListingIngestFailureTrace {
  const at = new Date().toISOString();
  if (err instanceof Error) {
    return {
      message: err.message,
      at,
      name: err.name,
      stack: err.stack,
    };
  }
  return { message: String(err), at };
}
