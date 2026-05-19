import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { normalizeAdapterId } from "./adapter-scoped-paths.js";

export const SCRAPE_LAYOUT_VERSION = 1;

export const scrapeLaneSchema = z.enum(["listings", "brokers"]);
export type ScrapeLane = z.infer<typeof scrapeLaneSchema>;

export const runStatusSchema = z.enum([
  "running",
  "completed",
  "partial",
  "failed",
  "aborted",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const listingIndexStatusSchema = z.enum([
  "ingested",
  "failed",
  "skipped_known",
  "skipped_fresh",
]);
export type ListingIndexStatus = z.infer<typeof listingIndexStatusSchema>;

export const runCountsSchema = z.object({
  discovered: z.number().int().nonnegative().optional(),
  ingested: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  skippedKnown: z.number().int().nonnegative().optional(),
  skippedFresh: z.number().int().nonnegative().optional(),
});
export type RunCounts = z.infer<typeof runCountsSchema>;

export const scrapeCumulativeSchema = z.object({
  discovered: z.number().int().nonnegative(),
  ingested: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skippedKnown: z.number().int().nonnegative(),
  skippedFresh: z.number().int().nonnegative(),
  satisfied: z.number().int().nonnegative(),
  lastUpdatedAt: z.string().datetime(),
  lastCompletedRunId: z.number().int().positive().optional(),
});
export type ScrapeCumulative = z.infer<typeof scrapeCumulativeSchema>;

export const scrapeMetaSchema = z.object({
  version: z.literal(SCRAPE_LAYOUT_VERSION),
  lane: scrapeLaneSchema,
  scrapeId: z.string().min(1),
  domain: z.string().min(1),
  adapter: z.string().min(1),
  catalogUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
  nextRunId: z.number().int().positive(),
  latestRunId: z.number().int().positive().optional(),
  cumulative: scrapeCumulativeSchema,
});
export type ScrapeMeta = z.infer<typeof scrapeMetaSchema>;

export const scrapeRunSchema = z.object({
  version: z.literal(SCRAPE_LAYOUT_VERSION),
  runId: z.number().int().positive(),
  status: runStatusSchema,
  kind: z.string().min(1).optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  thisRun: runCountsSchema.optional(),
  parentRunId: z.number().int().positive().optional(),
});
export type ScrapeRun = z.infer<typeof scrapeRunSchema>;

export const listingIndexSchema = z.object({
  version: z.literal(SCRAPE_LAYOUT_VERSION),
  listingId: z.string().min(1),
  adapter: z.string().min(1),
  url: z.string().url(),
  status: listingIndexStatusSchema,
  lastAttemptRunId: z.number().int().positive().optional(),
  lastSuccessRunId: z.number().int().positive().optional(),
  canonicalId: z.string().optional(),
  sourceRecordId: z.string().optional(),
  updatedAt: z.string().datetime(),
});
export type ListingIndex = z.infer<typeof listingIndexSchema>;

const evidenceRefSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  sha256: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export const listingRunManifestSchema = z.object({
  version: z.literal(SCRAPE_LAYOUT_VERSION),
  listingId: z.string().min(1),
  runId: z.number().int().positive(),
  at: z.string().datetime(),
  evidenceRef: evidenceRefSchema.optional(),
  processedArtifactKeys: z.array(z.string()).optional(),
  /** When blobs live outside DATA_DIR (e.g. `data1` during migration). */
  evidenceDataRoot: z.string().optional(),
});
export type ListingRunManifest = z.infer<typeof listingRunManifestSchema>;

/** Registrable domain for scrape paths (`www.bizbuysell.com` → `bizbuysell.com`). */
export function domainFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "unknown";
  }
}

/** Stable scrape slug from a catalog or directory URL path. */
export function scrapeIdFromUrl(targetUrl: string): string {
  try {
    const slug = new URL(targetUrl).pathname.replace(/^\/+|\/+$/g, "");
    return slug || "catalog";
  } catch {
    return "catalog";
  }
}

export function scrapesRoot(dataRootDir: string): string {
  return join(dataRootDir, "scrapes");
}

export function scrapeBaseDir(
  dataRootDir: string,
  lane: ScrapeLane,
  domain: string,
  scrapeId: string,
): string {
  const safeDomain = domain.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safeScrapeId = scrapeId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return join(scrapesRoot(dataRootDir), lane, safeDomain, safeScrapeId);
}

export function scrapeMetaPath(
  dataRootDir: string,
  lane: ScrapeLane,
  domain: string,
  scrapeId: string,
): string {
  return join(
    scrapeBaseDir(dataRootDir, lane, domain, scrapeId),
    "scrape.json",
  );
}

export function scrapeRunPath(
  dataRootDir: string,
  lane: ScrapeLane,
  domain: string,
  scrapeId: string,
  runId: number,
): string {
  return join(
    scrapeBaseDir(dataRootDir, lane, domain, scrapeId),
    "runs",
    String(runId),
    "run.json",
  );
}

export function scrapeRunDiscoveryRefsPath(
  dataRootDir: string,
  lane: ScrapeLane,
  domain: string,
  scrapeId: string,
  runId: number,
): string {
  return join(
    scrapeBaseDir(dataRootDir, lane, domain, scrapeId),
    "runs",
    String(runId),
    "discovery",
    "refs.json",
  );
}

export function listingIndexPath(
  dataRootDir: string,
  lane: ScrapeLane,
  domain: string,
  scrapeId: string,
  listingId: string,
): string {
  const safeId = listingId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return join(
    scrapeBaseDir(dataRootDir, lane, domain, scrapeId),
    "listings",
    safeId,
    "index.json",
  );
}

export function listingRunManifestPath(
  dataRootDir: string,
  lane: ScrapeLane,
  domain: string,
  scrapeId: string,
  listingId: string,
  runId: number,
): string {
  const safeId = listingId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return join(
    scrapeBaseDir(dataRootDir, lane, domain, scrapeId),
    "listings",
    safeId,
    "runs",
    String(runId),
    "manifest.json",
  );
}

export function emptyCumulative(at: string): ScrapeCumulative {
  return {
    discovered: 0,
    ingested: 0,
    failed: 0,
    skippedKnown: 0,
    skippedFresh: 0,
    satisfied: 0,
    lastUpdatedAt: at,
  };
}

export function cumulativeFromListingIndexes(
  indexes: Pick<ListingIndex, "status">[],
  discovered: number,
  at: string,
  lastCompletedRunId?: number,
): ScrapeCumulative {
  let ingested = 0;
  let failed = 0;
  let skippedKnown = 0;
  let skippedFresh = 0;
  for (const row of indexes) {
    if (row.status === "ingested") ingested++;
    else if (row.status === "failed") failed++;
    else if (row.status === "skipped_known") skippedKnown++;
    else if (row.status === "skipped_fresh") skippedFresh++;
  }
  const satisfied = ingested + skippedKnown + skippedFresh;
  return {
    discovered,
    ingested,
    failed,
    skippedKnown,
    skippedFresh,
    satisfied,
    lastUpdatedAt: at,
    lastCompletedRunId,
  };
}

export async function readScrapeMeta(path: string): Promise<ScrapeMeta | null> {
  try {
    const raw = await readFile(path, "utf8");
    return scrapeMetaSchema.parse(JSON.parse(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function writeScrapeMeta(
  path: string,
  meta: ScrapeMeta,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export async function readScrapeRun(path: string): Promise<ScrapeRun | null> {
  try {
    const raw = await readFile(path, "utf8");
    return scrapeRunSchema.parse(JSON.parse(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function writeScrapeRun(
  path: string,
  run: ScrapeRun,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export async function readListingIndex(
  path: string,
): Promise<ListingIndex | null> {
  try {
    const raw = await readFile(path, "utf8");
    return listingIndexSchema.parse(JSON.parse(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function writeListingIndex(
  path: string,
  index: ListingIndex,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

export async function writeListingRunManifest(
  path: string,
  manifest: ListingRunManifest,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** Allocate the next run id and persist `nextRunId` on scrape meta. */
export async function allocateNextRunId(metaPath: string): Promise<number> {
  const existing = await readScrapeMeta(metaPath);
  if (!existing) {
    throw new Error(`scrape meta missing: ${metaPath}`);
  }
  const runId = existing.nextRunId;
  const next: ScrapeMeta = {
    ...existing,
    nextRunId: runId + 1,
    latestRunId: runId,
  };
  await writeScrapeMeta(metaPath, next);
  return runId;
}

export function createInitialScrapeMeta(input: {
  lane: ScrapeLane;
  scrapeId: string;
  domain: string;
  adapter: string;
  catalogUrl?: string;
  createdAt?: string;
  discovered?: number;
}): ScrapeMeta {
  const at = input.createdAt ?? new Date().toISOString();
  return {
    version: SCRAPE_LAYOUT_VERSION,
    lane: input.lane,
    scrapeId: input.scrapeId,
    domain: input.domain,
    adapter: normalizeAdapterId(input.adapter),
    catalogUrl: input.catalogUrl,
    createdAt: at,
    nextRunId: 1,
    cumulative: {
      ...emptyCumulative(at),
      discovered: input.discovered ?? 0,
    },
  };
}
