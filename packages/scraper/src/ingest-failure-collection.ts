import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ListingRef } from "@clearbolt/core";
import {
  ingestFailuresPath as adapterIngestFailuresPath,
  normalizeAdapterId,
} from "./adapter-scoped-paths.js";
import { formatIngestError } from "./ingest-failure-log.js";
import type { ListingIngestFailureTrace } from "./listing-ingest-state.js";
import type { ListingIngestState } from "./listing-ingest-state.js";

export const INGEST_FAILURES_FILE_VERSION = 1;

export type IngestFailureEntry = {
  adapter: string;
  externalId: string;
  url: string;
  message: string;
  at: string;
  attempts: number;
};

export type IngestFailuresCollection = {
  version: typeof INGEST_FAILURES_FILE_VERSION;
  /** Set on per-adapter files under `ingest-failures/<adapter>.json`. */
  adapter?: string;
  updatedAt: string;
  failures: Record<string, IngestFailureEntry>;
};

/** Monolithic pre-adapter path (`<dataRoot>/ingest-failures.json`). */
export function legacyIngestFailuresPath(dataRootDir: string): string {
  return join(dataRootDir, "ingest-failures.json");
}

export function defaultIngestFailuresPath(
  dataRootDir: string,
  adapter: string,
): string {
  return adapterIngestFailuresPath(dataRootDir, adapter);
}

export function ingestFailuresEnabled(filePath: string | undefined): boolean {
  if (process.env.CLEARBOLT_INGEST_FAILURES === "0") return false;
  return Boolean(filePath?.trim());
}

function emptyCollection(adapter?: string): IngestFailuresCollection {
  return {
    version: INGEST_FAILURES_FILE_VERSION,
    ...(adapter ? { adapter } : {}),
    updatedAt: new Date().toISOString(),
    failures: {},
  };
}

function adapterIdFromIngestFailuresPath(filePath: string): string | undefined {
  const base = filePath.replace(/\\/g, "/");
  const m = base.match(/\/ingest-failures\/([^/]+)\.json$/i);
  return m?.[1] ? normalizeAdapterId(m[1]) : undefined;
}

export async function readIngestFailuresCollection(
  filePath: string,
): Promise<IngestFailuresCollection> {
  try {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw) as IngestFailuresCollection;
    if (data.version !== INGEST_FAILURES_FILE_VERSION) {
      return emptyCollection();
    }
    const pathAdapter = adapterIdFromIngestFailuresPath(filePath);
    const adapter = pathAdapter ?? data.adapter?.trim();
    const failures: Record<string, IngestFailureEntry> = {};
    for (const [id, entry] of Object.entries(data.failures ?? {})) {
      if (adapter && entry.adapter !== adapter) continue;
      failures[id] = entry;
    }
    return {
      version: INGEST_FAILURES_FILE_VERSION,
      ...(adapter ? { adapter } : {}),
      updatedAt: data.updatedAt ?? new Date().toISOString(),
      failures,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyCollection();
    throw err;
  }
}

async function writeIngestFailuresCollection(
  filePath: string,
  collection: IngestFailuresCollection,
): Promise<void> {
  const body: IngestFailuresCollection = {
    ...collection,
    version: INGEST_FAILURES_FILE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(body, null, 2), "utf8");
}

export async function recordIngestFailure(
  filePath: string,
  ref: ListingRef,
  adapter: string,
  err: unknown,
  trace?: ListingIngestFailureTrace,
): Promise<void> {
  if (!ingestFailuresEnabled(filePath)) return;
  const externalId = ref.externalId?.trim();
  if (!externalId) return;

  const pathAdapter = adapterIdFromIngestFailuresPath(filePath);
  if (pathAdapter && pathAdapter !== normalizeAdapterId(adapter)) {
    throw new Error(
      `Ingest failure path is for adapter ${pathAdapter}, not ${adapter} (${filePath})`,
    );
  }

  const collection = await readIngestFailuresCollection(filePath);
  const prev = collection.failures[externalId];
  collection.failures[externalId] = {
    adapter,
    externalId,
    url: ref.url,
    message: trace?.message ?? formatIngestError(err),
    at: trace?.at ?? new Date().toISOString(),
    attempts: (prev?.attempts ?? 0) + 1,
  };
  collection.adapter = adapter;
  await writeIngestFailuresCollection(filePath, collection);
}

export async function clearIngestFailure(
  filePath: string,
  externalId: string,
): Promise<void> {
  if (!ingestFailuresEnabled(filePath)) return;
  const collection = await readIngestFailuresCollection(filePath);
  if (!collection.failures[externalId]) return;
  delete collection.failures[externalId];
  await writeIngestFailuresCollection(filePath, collection);
}

export function listIngestFailureRefs(
  collection: IngestFailuresCollection,
  adapter?: string,
): ListingRef[] {
  return Object.values(collection.failures)
    .filter((f) => !adapter || f.adapter === adapter)
    .map((f) => ({
      url: f.url,
      externalId: f.externalId,
    }));
}

/** Source of truth for `--retry-failures-only`: only `status: failed` rows on disk. */
export async function listFailedListingRefsFromDisk(
  dataRootDir: string,
  adapter: string,
): Promise<ListingRef[]> {
  const refs: ListingRef[] = [];
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
    if (code === "ENOENT") return refs;
    throw err;
  }
  for (const entry of entries) {
    const statePath = join(base, entry, "state.json");
    try {
      const raw = await readFile(statePath, "utf8");
      const state = JSON.parse(raw) as ListingIngestState;
      if (state.status !== "failed" || !state.externalId) continue;
      if (normalizeAdapterId(state.adapter) !== normalizeAdapterId(adapter)) {
        continue;
      }
      refs.push({ url: state.url, externalId: state.externalId });
    } catch {
      /* skip */
    }
  }
  return refs;
}

export function countAkamaiHardBlockFailures(
  collection: IngestFailuresCollection,
): number {
  return Object.values(collection.failures).filter((f) =>
    isNonRetriableIngestFailureMessage(f.message),
  ).length;
}

export function isNonRetriableIngestFailureMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("hard block") ||
    m.includes("not retriable") ||
    m.includes("akamai hard")
  );
}

export function countNonRetriableIngestFailures(
  collection: IngestFailuresCollection,
): number {
  return Object.values(collection.failures).filter((f) =>
    isNonRetriableIngestFailureMessage(f.message),
  ).length;
}

/**
 * Order refs for ingest. Default: unchanged order, non-retriable failures omitted
 * (use `--retry-failures-only` to retry them). With `prioritizeFailures`, retriable
 * failures move to the front; hard blocks stay at the back.
 */
export function orderListingRefsForIngest(
  refs: ListingRef[],
  collection: IngestFailuresCollection,
  options?: { prioritizeFailures?: boolean; adapter?: string },
): ListingRef[] {
  const failures = collection.failures;
  const adapterFilter = options?.adapter ?? collection.adapter;
  if (Object.keys(failures).length === 0) return refs;

  const failureForRef = (
    id: string | undefined,
  ): IngestFailureEntry | undefined => {
    if (!id) return undefined;
    const entry = failures[id];
    if (!entry) return undefined;
    if (adapterFilter && entry.adapter !== adapterFilter) return undefined;
    return entry;
  };

  const retriableFront: ListingRef[] = [];
  const normal: ListingRef[] = [];
  const hardBlock: ListingRef[] = [];
  const seen = new Set<string>();

  const bucket = (ref: ListingRef): void => {
    const id = ref.externalId?.trim();
    const key = id ?? ref.url;
    if (seen.has(key)) return;
    seen.add(key);
    const entry = failureForRef(id);
    if (!entry) {
      normal.push(ref);
      return;
    }
    if (isNonRetriableIngestFailureMessage(entry.message)) {
      hardBlock.push(ref);
    } else if (options?.prioritizeFailures) {
      retriableFront.push(ref);
    } else {
      normal.push(ref);
    }
  };

  for (const ref of refs) bucket(ref);

  if (options?.prioritizeFailures) {
    for (const f of Object.values(failures)) {
      if (adapterFilter && f.adapter !== adapterFilter) continue;
      if (seen.has(f.externalId)) continue;
      seen.add(f.externalId);
      const ref = { url: f.url, externalId: f.externalId };
      if (isNonRetriableIngestFailureMessage(f.message)) hardBlock.push(ref);
      else retriableFront.push(ref);
    }
    return [...retriableFront, ...normal, ...hardBlock];
  }

  for (const f of Object.values(failures)) {
    if (adapterFilter && f.adapter !== adapterFilter) continue;
    if (seen.has(f.externalId)) continue;
    if (isNonRetriableIngestFailureMessage(f.message)) continue;
    seen.add(f.externalId);
    normal.push({ url: f.url, externalId: f.externalId });
  }

  return normal;
}

/** @deprecated Use `orderListingRefsForIngest` */
export function prioritizeFailedListingRefs(
  refs: ListingRef[],
  collection: IngestFailuresCollection,
): ListingRef[] {
  return orderListingRefsForIngest(refs, collection, {
    prioritizeFailures: true,
  });
}

async function migrateLegacyIngestFailures(
  dataRootDir: string,
  adapter: string,
  targetPath: string,
): Promise<IngestFailuresCollection | null> {
  const legacyPath = legacyIngestFailuresPath(dataRootDir);
  try {
    const legacy = await readIngestFailuresCollection(legacyPath);
    const filtered: Record<string, IngestFailureEntry> = {};
    for (const entry of Object.values(legacy.failures)) {
      if (entry.adapter === adapter) {
        filtered[entry.externalId] = entry;
      }
    }
    if (Object.keys(filtered).length === 0) return null;
    const collection: IngestFailuresCollection = {
      version: INGEST_FAILURES_FILE_VERSION,
      adapter,
      updatedAt: new Date().toISOString(),
      failures: filtered,
    };
    await writeIngestFailuresCollection(targetPath, collection);
    return collection;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/** Rebuild the collection from per-listing `listing-ingest-state/.../state.json` with `status: failed`. */
export async function syncIngestFailuresFromDisk(
  dataRootDir: string,
  adapter: string,
  filePath: string,
): Promise<IngestFailuresCollection> {
  const collection = emptyCollection(adapter);
  const base = join(dataRootDir, "listing-ingest-state", adapter);
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const migrated = await migrateLegacyIngestFailures(
        dataRootDir,
        adapter,
        filePath,
      );
      if (migrated) return migrated;
      await writeIngestFailuresCollection(filePath, collection);
      return collection;
    }
    throw err;
  }

  for (const entry of entries) {
    const statePath = join(base, entry, "state.json");
    try {
      const raw = await readFile(statePath, "utf8");
      const state = JSON.parse(raw) as ListingIngestState;
      if (state.status !== "failed" || !state.externalId) continue;
      if (normalizeAdapterId(state.adapter) !== normalizeAdapterId(adapter)) {
        continue;
      }
      collection.failures[state.externalId] = {
        adapter: state.adapter,
        externalId: state.externalId,
        url: state.url,
        message: state.failure?.message ?? "unknown failure",
        at: state.failure?.at ?? state.at,
        attempts: 1,
      };
    } catch {
      /* skip corrupt */
    }
  }

  collection.adapter = adapter;
  if (Object.keys(collection.failures).length === 0) {
    const migrated = await migrateLegacyIngestFailures(
      dataRootDir,
      adapter,
      filePath,
    );
    if (migrated) return migrated;
  }
  await writeIngestFailuresCollection(filePath, collection);
  return collection;
}
